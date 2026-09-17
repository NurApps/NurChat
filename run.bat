@echo off
title NurChat
set PYTHONUTF8=1

:: Force SQLite — avoids Supabase Postgres connection issues and keeps DB local
set DATABASE_URL=sqlite:///./nurchat.db

echo === NurChat Launcher ===
echo.

:: Check if server already running on :8000
curl -s http://127.0.0.1:8000/health >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Server already running on :8000
) else (
    echo [..] Starting relay server...
    start "NurChat Relay" /B .venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000
    echo [OK] Relay starting on http://127.0.0.1:8000
    :: Wait for server to be ready
    echo [..] Waiting for server...
    :wait_loop
    timeout /t 1 /nobreak >nul
    curl -s http://127.0.0.1:8000/health | findstr /C:"healthy" >nul 2>&1
    if %errorlevel% neq 0 goto wait_loop
    echo [OK] Server ready
)

echo.
echo [..] Starting Tauri dev...
npx tauri dev

:: Cleanup on exit
echo.
taskkill /f /im python.exe >nul 2>&1
echo Server stopped.
