@echo off
REM Thin shim for Tauri beforeDevCommand (see tauri.conf.json).
REM Real logic lives in the single root launcher: ..\run.bat
call "%~dp0..\run.bat" vite
