@echo off
cd /d "%~dp0"

REM Start FastAPI relay in background
start /B .venv\Scripts\python.exe -m uvicorn server.main:app --host 127.0.0.1 --port 8000 --no-access-log

REM Start Vite dev server
cd /d "%~dp0frontend"
npx vite --port 5173
