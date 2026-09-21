@echo off
title NurChat
cd /d "%~dp0"
set PYTHONUTF8=1

:: Единый лаунчер NurChat (Windows).
:: Без аргументов — интерактивное меню. С аргументом — прямой режим
:: (для скриптов, Tauri beforeDev, Планировщика):
::   run.bat dev      - relay (SQLite) + Tauri
::   run.bat vite     - relay (SQLite) + Vite (браузер :5173)
::   run.bat relay    - только relay, foreground, .env как есть
::   run.bat tunnel   - relay (фон, .env как есть) + cloudflared
::   run.bat build    - сборка Tauri-инсталлера (.exe)
::   run.bat checks   - быстрые проверки (ruff + pytest-подмножество)
::
:: dev/vite форсируют SQLite, чтобы локальная разработка не упиралась
:: в Supabase из .env. relay/tunnel .env НЕ трогают: аккаунты живут
:: в настроенной БД, смена БД = потеря аккаунтов.

set MODE=%~1
if "%MODE%"=="" (
  set INTERACTIVE=1
  goto menu
)
set INTERACTIVE=0
goto dispatch

:menu
cls
echo ========================================
echo   NurChat — launcher
echo ========================================
echo.
echo   1^) Dev full       relay (SQLite) + Tauri app
echo   2^) Frontend       relay (SQLite) + Vite (browser :5173)
echo   3^) Relay only     foreground, .env as-is
echo   4^) Relay + tunnel relay (bg) + cloudflared -^> internet
echo   5^) Build          Tauri installer (.exe)
echo   6^) Checks         ruff + fast pytest subset
echo   0^) Exit
echo.
choice /c 1234560 /n /m "  Select [1-6,0]: "
if %errorlevel%==7 goto bye
if %errorlevel%==6 set MODE=checks
if %errorlevel%==5 set MODE=build
if %errorlevel%==4 set MODE=tunnel
if %errorlevel%==3 set MODE=relay
if %errorlevel%==2 set MODE=vite
if %errorlevel%==1 set MODE=dev

:dispatch
if /i "%MODE%"=="dev" call :act_dev
if /i "%MODE%"=="vite" call :act_vite
if /i "%MODE%"=="relay" call :act_relay
if /i "%MODE%"=="tunnel" call :act_tunnel
if /i "%MODE%"=="build" call :act_build
if /i "%MODE%"=="checks" call :act_checks
if /i "%MODE%"=="dev" goto after_action
if /i "%MODE%"=="vite" goto after_action
if /i "%MODE%"=="relay" goto after_action
if /i "%MODE%"=="tunnel" goto after_action
if /i "%MODE%"=="build" goto after_action
if /i "%MODE%"=="checks" goto after_action
echo Unknown mode "%MODE%". Use: dev ^| vite ^| relay ^| tunnel ^| build ^| checks
exit /b 1

:after_action
if "%INTERACTIVE%"=="1" (
  echo.
  pause
  goto menu
)
exit /b 0

:bye
echo Bye.
exit /b 0

:: ============ actions ============

:act_dev
set DATABASE_URL=sqlite:///./nurchat.db
set RELAY_FLAGS=--reload
call :ensure_relay
if %errorlevel% neq 0 goto :eof
echo [..] Starting Tauri dev...
call npx tauri dev
call :stop_relay_if_mine
goto :eof

:act_vite
set DATABASE_URL=sqlite:///./nurchat.db
set RELAY_FLAGS=--reload
call :ensure_relay
if %errorlevel% neq 0 goto :eof
echo [..] Starting Vite (http://localhost:5173)...
cd frontend
call npm run dev
cd /d "%~dp0"
call :stop_relay_if_mine
goto :eof

:act_relay
echo [..] Relay foreground, .env as-is. Ctrl+C to stop.
.venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --no-access-log
goto :eof

:act_tunnel
:: Туннельный quick-URL случаен при каждом рестарте — явно перечислить его
:: в CORS_ORIGINS нельзя, поэтому сервер пускает *.trycloudflare.com через
:: regex. Ручную настройку не затираем. Без этого браузер режет /health и
:: API с Vite (http://127.0.0.1:5173) CORS-блоком.
if not defined CORS_ORIGIN_REGEX set CORS_ORIGIN_REGEX=https://[a-z0-9-]+\.trycloudflare\.com
call :ensure_relay_prod
if %errorlevel% neq 0 goto :eof
where cloudflared >nul 2>&1
if %errorlevel% neq 0 (
  echo [!!] cloudflared not found: winget install --id Cloudflare.cloudflared
  call :stop_relay_if_mine
  exit /b 1
)
echo [..] NOTE: quick-tunnel URL changes on every restart. Stable address = named tunnel.
cloudflared tunnel --url http://localhost:8000
call :stop_relay_if_mine
goto :eof

:act_build
set TAURI_CONF=src-tauri\tauri.conf.json
set TAURI_CONF_BAK=src-tauri\tauri.conf.json.bak-run
set HAVE_KEY=0
for %%A in (update_key_private.key) do if %%~zA GTR 50 set HAVE_KEY=1
if "%HAVE_KEY%"=="1" (
  echo [OK] Signing key found - signed build with updater.
  for /f "usebackq delims=" %%k in ("update_key_private.key") do set TAURI_SIGNING_PRIVATE_KEY=%%k
  set TAURI_SIGNING_PRIVATE_KEY_PASSWORD=
  call npx tauri build
  exit /b %errorlevel%
)
echo [..] No signing key - unsigned build (updater section stripped temporarily, config restored after).
copy /Y "%TAURI_CONF%" "%TAURI_CONF_BAK%" >nul
node -e "const fs=require('fs');const p='src-tauri/tauri.conf.json';const c=JSON.parse(fs.readFileSync(p,'utf8'));delete c.plugins.updater;fs.writeFileSync(p,JSON.stringify(c,null,2));"
call npx tauri build
set BUILD_RC=%errorlevel%
copy /Y "%TAURI_CONF_BAK%" "%TAURI_CONF%" >nul
del "%TAURI_CONF_BAK%" >nul 2>&1
exit /b %BUILD_RC%

:act_checks
echo [..] ruff...
.venv\Scripts\python.exe -m ruff check .
if %errorlevel% neq 0 goto :eof
echo [..] pytest (fast subset)...
.venv\Scripts\python.exe -m pytest test/test_call_join_accept.py test/test_deaf_calls.py -q
goto :eof

:: ============ helpers ============

:ensure_relay
curl -s -m 2 http://127.0.0.1:8000/health >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] Relay already on :8000
  exit /b 0
)
:: Порт может быть занят "зависшим" процессом с прошлого неудачного запуска
:: (health не отвечает, но порт всё ещё держится) - освобождаем, иначе
:: uvicorn не сможет забиндиться и wait_relay зависнет навсегда.
:: /T обязателен: --reload поднимает reloader + отдельный дочерний
:: server-процесс, PID в netstat - это reloader, kill без /T убивает
:: только его, а дочерний процесс остаётся висеть на порту.
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /T /PID %%p >nul 2>&1
echo [..] Starting relay in background...
start "NurChat Relay" /B .venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 %RELAY_FLAGS% --no-access-log
set RELAY_STARTED_BY_ME=1
set WAIT_RELAY_TRIES=0
goto wait_relay

:ensure_relay_prod
set RELAY_FLAGS=
call :ensure_relay
goto :eof

:wait_relay
set /a WAIT_RELAY_TRIES+=1
if %WAIT_RELAY_TRIES% gtr 20 (
  echo [!!] Relay didn't come up on :8000 in time - aborting.
  call :stop_relay_if_mine
  exit /b 1
)
timeout /t 1 /nobreak >nul
curl -s -m 2 http://127.0.0.1:8000/health | findstr /C:"healthy" >nul 2>&1
if %errorlevel% neq 0 goto wait_relay
echo [OK] Relay on http://127.0.0.1:8000
goto :eof

:stop_relay_if_mine
if not "%RELAY_STARTED_BY_ME%"=="1" (
  echo [..] Relay left running (was already up).
  exit /b 0
)
echo [..] Stopping relay on :8000...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /T /PID %%p >nul 2>&1
set RELAY_STARTED_BY_ME=
goto :eof
