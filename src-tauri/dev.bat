@echo off
cd /d "%~dp0\.."
REM Kill any existing relay server on port 8000
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
REM Start relay server in background
start "NurChat Relay" /B .venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload --no-access-log
echo [NurChat] Relay started on http://127.0.0.1:8000
REM Start Vite dev server (blocks until exit)
cd /d "%~dp0\frontend"
call npm run dev
