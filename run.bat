@echo off
title NurChat
cd /d "%~dp0"
set PYTHONUTF8=1

:: Единый лаунчер NurChat (Windows).
::   run.bat          - dev: relay (SQLite) + Tauri
::   run.bat vite     - relay (SQLite) + Vite (браузер / Tauri beforeDev)
::   run.bat relay    - только relay, foreground, .env как есть (prod-флаги)
::   run.bat tunnel   - relay (фон, .env как есть) + cloudflared quick tunnel
::   run.bat build    - сборка Tauri-инсталлера
::
:: dev/vite форсируют SQLite, чтобы локальная разработка не упиралась
:: в Supabase из .env. relay/tunnel .env НЕ трогают: аккаунты друзей
:: живут в настроенной БД, смена БД = потеря аккаунтов.

set MODE=%~1
if "%MODE%"=="" set MODE=dev

if /i "%MODE%"=="dev" goto dev
if /i "%MODE%"=="vite" goto vite
if /i "%MODE%"=="relay" goto relay
if /i "%MODE%"=="tunnel" goto tunnel
if /i "%MODE%"=="build" goto build
echo Unknown mode "%MODE%". Use: dev ^| vite ^| relay ^| tunnel ^| build
exit /b 1

:dev
set DATABASE_URL=sqlite:///./nurchat.db
set RELAY_FLAGS=--reload
call :ensure_relay
echo [..] Starting Tauri dev...
npx tauri dev
call :stop_relay_if_mine
exit /b 0

:vite
set DATABASE_URL=sqlite:///./nurchat.db
set RELAY_FLAGS=--reload
call :ensure_relay
echo [..] Starting Vite (http://localhost:5173)...
cd frontend
call npm run dev
exit /b 0

:relay
echo [..] Relay foreground, .env as-is. Ctrl+C to stop.
.venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --no-access-log
exit /b 0

:tunnel
call :ensure_relay_prod
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
  echo [!!] cloudflared not found: winget install --id Cloudflare.cloudflared
  call :stop_relay_if_mine
  exit /b 1
)
echo [..] NOTE: quick-tunnel URL changes on every restart. Stable address = named tunnel.
cloudflared tunnel --url http://localhost:8000
call :stop_relay_if_mine
exit /b 0

:build
echo [..] Building Tauri installer...
npx tauri build
exit /b 0

:ensure_relay
curl -s -m 2 http://127.0.0.1:8000/health >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] Relay already on :8000
  goto :eof
)
echo [..] Starting relay in background...
start "NurChat Relay" /B .venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 %RELAY_FLAGS% --no-access-log
set RELAY_STARTED_BY_ME=1
goto wait_relay

:ensure_relay_prod
set RELAY_FLAGS=
call :ensure_relay
goto :eof

:wait_relay
timeout /t 1 /nobreak >nul
curl -s -m 2 http://127.0.0.1:8000/health | findstr /C:"healthy" >nul 2>&1
if %errorlevel% neq 0 goto wait_relay
echo [OK] Relay on http://127.0.0.1:8000
goto :eof

:stop_relay_if_mine
if not "%RELAY_STARTED_BY_ME%"=="1" (
  echo [..] Relay left running (was already up).
  goto :eof
)
echo [..] Stopping relay on :8000...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /PID %%p >nul 2>&1
goto :eof
