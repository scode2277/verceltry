#!/bin/bash
set -e

echo "Running Vercel prebuild for Vocs with manual Chromium..."

# Ensure docs/pages exists
mkdir -p docs/pages

# Install dependencies
npm install

# Build the Vocs site
npm run docs:build

# Post-process search index for Vercel & local outputs
node utils/postprocess-search-index.js

echo "✅ Vocs build + search index post-processing completed successfully!"