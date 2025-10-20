#!/bin/bash
set -e

echo "Running Vercel prebuild for Vocs with manual Chromium..."

# Ensure docs/pages exists
mkdir -p docs/pages

# Install dependencies
pnpm install --frozen-lockfile

# Build the Vocs site
pnpm run docs:build

echo "✅ Vocs build + search index post-processing completed successfully!"
