@echo off
title NurChat Server Build

echo [1/3] Installing PyInstaller...
pip install pyinstaller>=6.0

echo [2/3] Building server.exe...
pyinstaller server.spec --clean --noconfirm
if errorlevel 1 exit /b %errorlevel%

echo [3/3] Copying to Tauri sidecar...
copy /Y dist\server.exe src-tauri\binaries\server-x86_64-pc-windows-msvc.exe

echo Done!
echo   Output: dist\server.exe
echo   Sidecar: src-tauri\binaries\server-x86_64-pc-windows-msvc.exe
echo.
pause
