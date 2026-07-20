@echo off
title NurChat Launcher

echo [1/2] Starting server...
start /B "" ".venv\Scripts\python" -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload > .venv\nurchat_server.log 2>&1

timeout /t 3 /nobreak >nul

echo [2/2] Starting Tauri app...
npx tauri dev

echo.
echo Server still running in background. Close with: taskkill /f /im python.exe