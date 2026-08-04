@echo off
title NurChat Build (Server + Tauri)

echo ======================================
echo   NurChat Full Build
echo ======================================
echo.

echo [1/4] Installing PyInstaller...
pip install pyinstaller>=6.0
if errorlevel 1 (
    echo ERROR: Failed to install PyInstaller
    exit /b %errorlevel%
)

echo [2/4] Building server.exe...
pyinstaller server.spec --clean --noconfirm
if errorlevel 1 (
    echo ERROR: PyInstaller build failed
    exit /b %errorlevel%
)

echo [3/4] Copying to Tauri sidecar location...
if not exist src-tauri\binaries mkdir src-tauri\binaries
copy /Y dist\server.exe src-tauri\binaries\server-x86_64-pc-windows-msvc.exe
if errorlevel 1 (
    echo ERROR: Failed to copy server.exe
    exit /b %errorlevel%
)

echo [4/4] Building Tauri app...
npx tauri build
if errorlevel 1 (
    echo ERROR: Tauri build failed
    exit /b %errorlevel%
)

echo.
echo ======================================
echo   Build complete!
echo   Installer: src-tauri\tauri-bundle\nsis\
echo ======================================
pause
