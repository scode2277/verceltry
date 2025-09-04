#!/bin/bash
set -e

echo "Running Vercel prebuild for Vocs with Playwright..."

# Ensure docs/pages exists
mkdir -p docs/pages

# Install dependencies
npm install

# Install only Chromium to save space/time
npx playwright install chromium

# Build the Vocs site
npm run docs:build

echo "Vocs build completed successfully!"