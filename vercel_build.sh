#!/bin/bash
set -e

echo "Running Vercel prebuild for Vocs with Mermaid diagrams..."

# Install dependencies
npm install

# Directory containing your .mmd files (with subfolders)
INPUT_DIR="docs/public/diagrams"

# Generate SVGs next to each .mmd file
find "$INPUT_DIR" -name "*.mmd" | while read f; do
  dir=$(dirname "$f")
  filename=$(basename "$f" .mmd)
  npx mmdc -i "$f" -o "$dir/$filename.svg"
  echo "✅ Generated $dir/$filename.svg"
done

# Build the Vocs site
echo "Building the docs site..."
npm run docs:build

echo "✅ Vercel build completed successfully!"
