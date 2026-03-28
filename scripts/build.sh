#!/usr/bin/env bash
set -euo pipefail

# Build ProjectRioStreamHelper for macOS
# Usage: ./scripts/build.sh
#
# Prerequisites:
#   - Node.js 18+ and npm
#   - Python 3.12+ with project dependencies installed
#   - pip install pyinstaller

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

echo "=== ProjectRioStreamHelper macOS Build ==="

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
pyinstaller PRSH.spec --noconfirm

# 5. Create zip for distribution
echo "[4/5] Creating distribution zip..."
cd dist
if [ -d "PRSH.app" ]; then
    zip -r -q "../PRSH-macOS.zip" PRSH.app
    echo ""
    echo "=== Build complete ==="
    echo "Output: PRSH-macOS.zip"
    echo "To test: unzip PRSH-macOS.zip && open PRSH.app"
elif [ -d "PRSH" ]; then
    zip -r -q "../PRSH-macOS.zip" PRSH
    echo ""
    echo "=== Build complete ==="
    echo "Output: PRSH-macOS.zip"
    echo "To test: unzip PRSH-macOS.zip && cd PRSH && ./PRSH"
else
    echo "WARNING: Could not find build output to zip"
    echo "Check dist/ for the built application"
fi
