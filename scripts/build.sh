#!/usr/bin/env bash
set -euo pipefail

# Build TournamentStreamHelper for macOS
# Usage: ./scripts/build.sh
#
# Prerequisites:
#   - Node.js 18+ and npm
#   - Python 3.12+ with project dependencies installed
#   - pip install pyinstaller

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== TournamentStreamHelper macOS Build ==="

# 1. Ensure git submodules
echo "[1/5] Checking git submodules..."
git submodule update --init --recursive

# 2. Build frontend
echo "[2/5] Building frontend..."
npm install --silent
npm run build

# 3. Verify dist/ exists
if [ ! -d "dist/assets" ]; then
    echo "ERROR: Frontend build failed — dist/assets not found"
    exit 1
fi

# 4. Run PyInstaller
echo "[3/5] Running PyInstaller..."
pip install pyinstaller -q 2>/dev/null || true
pyinstaller TSH.spec --noconfirm

# 5. Copy user_data template (writable at runtime)
echo "[4/5] Setting up user_data..."
if [ -d "dist_build/TSH" ]; then
    BUILD_DIR="dist_build/TSH"
elif [ -d "dist/TSH" ]; then
    # PyInstaller default output — but we use dist/ for Vite too, so check
    BUILD_DIR="dist/TSH"
else
    BUILD_DIR="$(find . -path '*/build/TSH' -o -path '*/dist/TSH.app' | head -1 | xargs dirname 2>/dev/null || echo 'dist/TSH')"
fi

# 6. Create zip for distribution
echo "[5/5] Creating distribution zip..."
cd dist
if [ -d "TSH.app" ]; then
    zip -r -q "../TSH-macOS.zip" TSH.app
    echo ""
    echo "=== Build complete ==="
    echo "Output: TSH-macOS.zip"
    echo "To test: unzip TSH-macOS.zip && open TSH.app"
elif [ -d "TSH" ]; then
    zip -r -q "../TSH-macOS.zip" TSH
    echo ""
    echo "=== Build complete ==="
    echo "Output: TSH-macOS.zip"
    echo "To test: unzip TSH-macOS.zip && cd TSH && ./TSH"
else
    echo "WARNING: Could not find build output to zip"
    echo "Check dist/ for the built application"
fi
