@echo off
title NurChat

set PYTHONUTF8=1

echo === NurChat Dev Launcher ===
echo.

:: 1. Check if uvicorn is already running
curl -s http://127.0.0.1:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Server already running on :8000
    set SERVER_RUNNING=1
) else (
    echo [..] Starting server via uvicorn...
    start /B "" ".venv\Scripts\python" -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --reload > .venv\nurchat_server.log 2>&1
    echo [OK] uvicorn starting in background
)

:: 2. Kill any stale server.exe from previous Tauri dev runs
taskkill /f /im server.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Stopped old server.exe instance
)

:: 3. Start Tauri dev (handles Rust + Vite, won't spawn another server since :8000 is up)

:: 2. Start Tauri dev (handles Rust + Vite, won't spawn another server since :8000 is up)
echo [..] Starting Tauri dev...
echo.
npx tauri dev

:: Cleanup
echo.
echo Server still running in background. Stop with:
echo   taskkill /f /im python.exe
