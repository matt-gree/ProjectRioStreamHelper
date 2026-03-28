# Build ProjectRioStreamHelper for Windows
# Usage: powershell -ExecutionPolicy Bypass -File scripts\build.ps1
#
# Prerequisites:
#   - Node.js 18+ and npm
#   - Python 3.12+ with project dependencies installed
#   - pip install pyinstaller

$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir

Write-Host "=== ProjectRioStreamHelper Windows Build ===" -ForegroundColor Cyan

# 1. Ensure git submodules
Write-Host "[1/5] Checking git submodules..."
git submodule update --init --recursive

# 2. Build frontend
Write-Host "[2/5] Building frontend..."
npm install --silent
npm run build

# 3. Verify dist/ exists
if (-not (Test-Path "dist\assets")) {
    Write-Host "ERROR: Frontend build failed - dist\assets not found" -ForegroundColor Red
    exit 1
}

# 4. Run PyInstaller
Write-Host "[3/5] Running PyInstaller..."
pip install pyinstaller -q 2>$null
pyinstaller PRSH.spec --noconfirm

# 5. Verify build output
Write-Host "[4/5] Verifying build..."
if (-not (Test-Path "dist\PRSH\PRSH.exe")) {
    Write-Host "ERROR: PyInstaller build failed - PRSH.exe not found" -ForegroundColor Red
    exit 1
}

# 6. Create zip for distribution
Write-Host "[5/5] Creating distribution zip..."
if (Test-Path "PRSH-Windows.zip") { Remove-Item "PRSH-Windows.zip" }
Compress-Archive -Path "dist\PRSH" -DestinationPath "PRSH-Windows.zip"

Write-Host ""
Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "Output: PRSH-Windows.zip"
Write-Host "To test: Extract zip, then double-click PRSH\PRSH.exe"
