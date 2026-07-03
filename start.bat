@echo off
title NurChat Launcher

echo [1/2] Starting server...
start "NurChat Server" cmd /k ".venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload"

timeout /t 3 /nobreak >nul

echo [2/2] Starting Tauri app...
npx tauri dev