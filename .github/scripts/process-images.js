const { S3Client } = require('@aws-sdk/client-s3');
const { Upload } = require('@aws-sdk/lib-storage');
const axios = require('axios');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const path = require('path');

// ============================================================================
// CONFIGURATION CONSTANTS
// ============================================================================
// These limits protect against resource exhaustion and abuse
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB maximum file size
const MAX_WIDTH = 4096;                  // Maximum image width in pixels
const MAX_HEIGHT = 4096;                 // Maximum image height in pixels

// Allowed image formats (for security, we only allow safe image formats)
// Note: SVG is included but should be validated separately if needed
const ALLOWED_FORMATS = ['jpeg', 'jpg', 'png', 'gif', 'webp', 'svg'];

// Request timeout in milliseconds (30 seconds)
const REQUEST_TIMEOUT = 30000;

// ============================================================================
// AWS S3 CLIENT INITIALIZATION
// ============================================================================
// Initialize the S3 client with credentials from environment variables
// These credentials are provided by GitHub Actions secrets
const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

// ============================================================================
// URL EXTRACTION FUNCTION
// ============================================================================
// This function validates GitHub-hosted image URLs
// Contributors add images to PR comments/descriptions, GitHub hosts them
// Maintainers approve specific URLs for security
async function extractDirectImageUrl(url) {
  console.log(`Checking if URL needs extraction: ${url}`);
  
  // Handle GitHub-hosted images (from PR comments/descriptions)
  // These are direct image URLs and don't need parsing
  // Formats:
  // - https://user-images.githubusercontent.com/...
  // - https://private-user-images.githubusercontent.com/... (with JWT tokens)
  // - https://github.com/.../assets/...
  if (url.includes('user-images.githubusercontent.com') || 
      url.includes('private-user-images.githubusercontent.com') ||
      (url.includes('github.com') && url.includes('/assets/'))) {
    console.log('Detected GitHub-hosted image URL (direct link, no extraction needed)');
    
    // Verify it's actually an image by checking the URL pattern
    const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
    const isImageUrl = imageExtensions.test(url.split('?')[0]) || url.includes('/assets/');
    
    if (isImageUrl) {
      console.log('✓ GitHub image URL verified');
      return url; // Already a direct link, return as-is (including JWT tokens)
    } else {
      throw new Error('GitHub URL does not appear to be an image. Please use a direct image URL from GitHub.');
    }
  }
  
  // Reject unknown URLs - we only accept GitHub-hosted images
  throw new Error('Only GitHub-hosted images are supported. Please add images to PR comments/descriptions and use the GitHub-provided URLs.');
}

// ============================================================================
// IMAGE DOWNLOAD FUNCTION
// ============================================================================
// Downloads an image from a URL and returns it as a Buffer
// Includes size limits and timeout protection
// For GitHub URLs, uses browser-like headers to ensure compatibility
async function downloadImage(url) {
  console.log(`Downloading: ${url}`);
  
  try {
    // Determine if this is a GitHub URL (requires authentication for private images)
    const isGitHubUrl = url.includes('github.com') || url.includes('user-images.githubusercontent.com');
    
    // Build headers
    // For GitHub URLs, use GITHUB_TOKEN if available (for private images)
    // The token is automatically provided by GitHub Actions
    const headers = {
      'User-Agent': 'GitHub-Image-Upload-Bot/1.0'
    };
    
    if (isGitHubUrl) {
      // Use browser-like headers for better compatibility
      headers['Accept'] = 'image/webp,image/apng,image/*,*/*;q=0.8';
      headers['Accept-Language'] = 'en-US,en;q=0.9';
      headers['Referer'] = 'https://github.com/';
      
      // Use GITHUB_TOKEN if available (for private images that require auth)
      // This allows the workflow to access private GitHub-hosted images
      // GITHUB_TOKEN is automatically provided by GitHub Actions
      if (process.env.GITHUB_TOKEN) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
        console.log('Using GITHUB_TOKEN for authentication');
      }
    }
    
    const response = await axios({
      url,
      method: 'GET',
      responseType: 'arraybuffer',  // Get binary data as array buffer
      maxContentLength: MAX_FILE_SIZE,  // Maximum content length
      maxBodyLength: MAX_FILE_SIZE,     // Maximum body length
      timeout: REQUEST_TIMEOUT,
      maxRedirects: 5,  // Follow redirects (GitHub may redirect)
      headers,
      // Validate status codes (only accept 2xx responses)
      validateStatus: (status) => status >= 200 && status < 300
    });

    // Convert array buffer to Node.js Buffer
    const buffer = Buffer.from(response.data);
    
    // Double-check file size (axios maxContentLength might not always work)
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`Image size (${(buffer.length / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (${MAX_FILE_SIZE / 1024 / 1024}MB)`);
    }
    
    console.log(`✓ Downloaded ${(buffer.length / 1024).toFixed(2)}KB`);
    return buffer;
  } catch (error) {
    if (error.response) {
      // HTTP error response
      const status = error.response.status;
      
      // Provide helpful error messages for common cases
      if (status === 404) {
        // Check if it's a GitHub URL that might have expired
        if (url.includes('private-user-images.githubusercontent.com') || 
            url.includes('user-images.githubusercontent.com')) {
          throw new Error('GitHub image URL not found or expired. Please ensure the URL is fresh and copied directly from a PR comment or description. If the URL works in your browser, it may require authentication that the workflow cannot provide.');
        }
        throw new Error(`HTTP ${status}: Image not found`);
      } else if (status === 403) {
        throw new Error(`HTTP ${status}: Access forbidden. The image URL may require authentication or the token may have expired.`);
      } else if (status === 410) {
        throw new Error(`HTTP ${status}: Image has been removed or expired. Please use a fresh URL from a PR comment.`);
      }
      throw new Error(`HTTP ${status}: Failed to download image`);
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Download timeout: Image took too long to download');
    } else {
      throw new Error(`Download failed: ${error.message}`);
    }
  }
}

// ============================================================================
// IMAGE VALIDATION FUNCTION
// ============================================================================
// Validates that the downloaded file is actually a valid image
// Checks format, dimensions, and file size
// Uses Sharp library to parse and validate image metadata
async function validateImage(buffer, originalUrl) {
  console.log('Validating image...');

  // Check file size first (before processing)
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`Image exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB size limit`);
  }

  // Use sharp to validate and get metadata
  // Sharp is a fast image processing library that can parse various formats
  try {
    // Get image metadata (format, dimensions, etc.)
    const metadata = await sharp(buffer).metadata();
    
    console.log('Image metadata:', {
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      size: `${(buffer.length / 1024).toFixed(2)}KB`
    });

    // Validate format (security: only allow safe image formats)
    if (!ALLOWED_FORMATS.includes(metadata.format)) {
      throw new Error(`Invalid format: ${metadata.format}. Allowed: ${ALLOWED_FORMATS.join(', ')}`);
    }

    // Validate dimensions (prevents overly large images)
    if (metadata.width > MAX_WIDTH || metadata.height > MAX_HEIGHT) {
      throw new Error(`Image dimensions ${metadata.width}x${metadata.height} exceed maximum ${MAX_WIDTH}x${MAX_HEIGHT}`);
    }

    // Basic malware/content check: ensure it's actually an image
    // Sharp will throw an error if the file is not a valid image
    // This helps prevent uploading executable files disguised as images
    await sharp(buffer).toBuffer();

    console.log('✓ Image validation passed');
    return metadata;
  } catch (error) {
    // If Sharp fails, the file is likely not a valid image
    throw new Error(`Image validation failed: ${error.message}`);
  }
}

// ============================================================================
// FILENAME GENERATION FUNCTION
// ============================================================================
// Generates a unique filename for the uploaded image
// Format: timestamp_uuid_hash_originalname.ext
// This ensures uniqueness and traceability
function generateUniqueFilename(originalUrl, format) {
  // Create timestamp in ISO format, sanitized for filesystem
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Generate UUID and take first segment for uniqueness
  const uniqueId = uuidv4().split('-')[0];
  
  // Create hash from original URL (for traceability)
  // Using MD5 hash (first 8 characters) to identify duplicates
  const hash = crypto.createHash('md5').update(originalUrl).digest('hex').substring(0, 8);
  
  // Try to preserve original filename if possible
  // This makes it easier to identify images in S3
  let originalName = 'image';
  try {
    const urlPath = new URL(originalUrl).pathname;
    const basename = path.basename(urlPath, path.extname(urlPath));
    
    // Sanitize filename: only allow alphanumeric, dashes, and underscores
    // Remove any special characters that could cause filesystem issues
    if (basename && basename !== '' && basename.length < 50) {
      originalName = basename.replace(/[^a-zA-Z0-9-_]/g, '-');
    }
  } catch (e) {
    // Use default if URL parsing fails
    // This is safe to ignore - we'll just use 'image' as the name
  }

  // Combine all parts to create unique filename
  return `${timestamp}_${uniqueId}_${hash}_${originalName}.${format}`;
}

// ============================================================================
// S3 UPLOAD FUNCTION
// ============================================================================
// Uploads the image buffer to AWS S3
// Uses multipart upload for large files (handled automatically by @aws-sdk/lib-storage)
async function uploadToS3(buffer, filename, contentType) {
  console.log(`Uploading to S3: ${filename}`);

  try {
    // Use Upload class for automatic multipart upload support
    // This handles large files efficiently by splitting them into parts
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: process.env.AWS_S3_BUCKET,
        Key: `images/${filename}`,  // All images go into 'images/' prefix
        Body: buffer,
        ContentType: contentType,    // Set proper MIME type
        CacheControl: 'public, max-age=31536000',  // Cache for 1 year
        ServerSideEncryption: 'AES256'  // Enable server-side encryption
      }
    });

    // Wait for upload to complete
    await upload.done();

    // Generate public URL for the uploaded image
    // Format: https://bucket-name.s3.region.amazonaws.com/images/filename
    const region = process.env.AWS_REGION;
    const bucket = process.env.AWS_S3_BUCKET;
    const publicUrl = `https://${bucket}.s3.${region}.amazonaws.com/images/${filename}`;
    
    console.log(`✓ Uploaded to S3: ${publicUrl}`);
    return publicUrl;
  } catch (error) {
    throw new Error(`S3 upload failed: ${error.message}`);
  }
}

// ============================================================================
// MAIN IMAGE PROCESSING FUNCTION
// ============================================================================
// Processes a single image URL through the entire pipeline:
// 1. Extract direct URL (if needed)
// 2. Download image
// 3. Validate image
// 4. Generate filename
// 5. Upload to S3
// Returns result object with success status and metadata
async function processImage(url) {
  try {
    // Step 1: Extract direct image URL if needed
    // Some URLs point to sharing pages that need to be parsed
    const directUrl = await extractDirectImageUrl(url);
    
    // Step 2: Download the image
    const buffer = await downloadImage(directUrl);
    
    // Step 3: Validate and get metadata
    const metadata = await validateImage(buffer, url);
    
    // Step 4: Generate unique filename
    const filename = generateUniqueFilename(url, metadata.format);
    
    // Step 5: Upload to S3
    const s3Url = await uploadToS3(
      buffer, 
      filename, 
      `image/${metadata.format}`
    );

    // Return success result with all metadata
    return {
      success: true,
      originalUrl: url,
      s3Url: s3Url,
      filename: filename,
      metadata: {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        size: `${(buffer.length / 1024).toFixed(2)}KB`
      }
    };
  } catch (error) {
    // Return failure result with error message
    // We don't throw here so other images can still be processed
    return {
      success: false,
      originalUrl: url,
      error: error.message
    };
  }
}

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================
// Reads URLs from file and processes them sequentially
async function main() {
  const fs = require('fs');
  let urls;
  
  // Read URLs from JSON file (created by previous workflow step)
  try {
    const rawData = fs.readFileSync('urls.json', 'utf8');
    urls = JSON.parse(rawData);
    
    // Validate that urls is an array
    if (!Array.isArray(urls)) {
      throw new Error('urls.json does not contain an array');
    }
    
    // Validate that we have at least one URL
    if (urls.length === 0) {
      throw new Error('No URLs found in urls.json');
    }
    
    console.log(`Processing ${urls.length} image(s)...`);
  } catch (error) {
    console.error('Failed to read/parse urls.json:', error.message);
    process.exit(1);
  }

  // Process each URL sequentially
  // Sequential processing prevents overwhelming the system with concurrent downloads
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] Processing: ${url.substring(0, 60)}...`);
    
    const result = await processImage(url);
    results.push(result);
    
    if (result.success) {
      console.log(`✓ Success: ${result.filename}`);
    } else {
      console.error(`✗ Failed: ${result.error}`);
    }
  }

  // Output results as JSON for GitHub Actions to capture
  // This is parsed by the workflow step that calls this script
  console.log('\nRESULTS:', JSON.stringify(results, null, 2));
}

// Run main function and handle any unhandled errors
main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});


