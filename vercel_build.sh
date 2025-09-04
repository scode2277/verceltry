#!/bin/bash
set -e

echo "Running Vercel prebuild for Vocs with manual Chromium..."

# Ensure docs/pages exists
mkdir -p docs/pages

# Install dependencies
npm install

# Directory for browsers
mkdir -p .playwright-browsers

# Download Chromium *headless_shell* build (revision 1187)
echo "Downloading Chromium headless_shell for Playwright..."
curl -sSL https://playwright.azureedge.net/builds/chromium/1187/chromium-headless-shell-linux.zip -o chromium.zip

# Extract and clean up
unzip chromium.zip -d .playwright-browsers/
rm chromium.zip

# Create expected folder structure
mkdir -p .playwright-browsers/chromium_headless_shell-1187
mv .playwright-browsers/chrome-linux .playwright-browsers/chromium_headless_shell-1187/

# Export Playwright browser path
export PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers

# Verify the binary exists
ls -l .playwright-browsers/chromium_headless_shell-1187/chrome-linux/headless_shell || {
  echo "❌ headless_shell binary not found!"
  exit 1
}

# Build the Vocs site
npm run docs:build

echo "✅ Vocs build completed successfully!"
