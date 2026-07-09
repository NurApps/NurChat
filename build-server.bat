@echo off
title NurChat Server Build

echo [1/3] Installing PyInstaller...
pip install pyinstaller>=6.0

echo [2/3] Building server.exe...
pyinstaller server.spec --clean --noconfirm

echo [3/3] Done!
echo.
echo Output: dist\server\server.exe
echo.
pause
