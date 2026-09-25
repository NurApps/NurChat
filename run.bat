@echo off
chcp 65001 >nul 2>&1 & rem UTF-8 консоль для кириллицы
title NurChat
cd /d "%~dp0"
set PYTHONUTF8=1

:: Р•РґРёРЅС‹Р№ Р»Р°СѓРЅС‡РµСЂ NurChat (Windows).
:: Р‘РµР· Р°СЂРіСѓРјРµРЅС‚РѕРІ вЂ” РёРЅС‚РµСЂР°РєС‚РёРІРЅРѕРµ РјРµРЅСЋ. РЎ Р°СЂРіСѓРјРµРЅС‚РѕРј вЂ” РїСЂСЏРјРѕР№ СЂРµР¶РёРј
:: (РґР»СЏ СЃРєСЂРёРїС‚РѕРІ, Tauri beforeDev, РџР»Р°РЅРёСЂРѕРІС‰РёРєР°):
::   run.bat dev      - relay (SQLite) + Tauri
::   run.bat vite     - relay (SQLite) + Vite (Р±СЂР°СѓР·РµСЂ :5173)
::   run.bat relay    - С‚РѕР»СЊРєРѕ relay, foreground, .env РєР°Рє РµСЃС‚СЊ
::   run.bat tunnel   - relay (С„РѕРЅ, .env РєР°Рє РµСЃС‚СЊ) + cloudflared
::   run.bat build    - СЃР±РѕСЂРєР° Tauri-РёРЅСЃС‚Р°Р»Р»РµСЂР° (.exe)
::   run.bat checks   - Р±С‹СЃС‚СЂС‹Рµ РїСЂРѕРІРµСЂРєРё (ruff + pytest-РїРѕРґРјРЅРѕР¶РµСЃС‚РІРѕ)
::
:: dev/vite С„РѕСЂСЃРёСЂСѓСЋС‚ SQLite, С‡С‚РѕР±С‹ Р»РѕРєР°Р»СЊРЅР°СЏ СЂР°Р·СЂР°Р±РѕС‚РєР° РЅРµ СѓРїРёСЂР°Р»Р°СЃСЊ
:: РІ Supabase РёР· .env. relay/tunnel .env РќР• С‚СЂРѕРіР°СЋС‚: Р°РєРєР°СѓРЅС‚С‹ Р¶РёРІСѓС‚
:: РІ РЅР°СЃС‚СЂРѕРµРЅРЅРѕР№ Р‘Р”, СЃРјРµРЅР° Р‘Р” = РїРѕС‚РµСЂСЏ Р°РєРєР°СѓРЅС‚РѕРІ.

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
echo   NurChat вЂ” launcher
echo ========================================
echo.
echo   1^) Dev full       relay (.env DB, else SQLite) + Tauri app
echo   2^) Frontend       relay (.env DB, else SQLite) + Vite (browser :5173)
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
call :ensure_pg_default
set RELAY_FLAGS=--reload
call :ensure_relay
if %errorlevel% neq 0 goto :eof
echo [..] Starting Tauri dev...
call npx tauri dev
call :stop_relay_if_mine
goto :eof

:act_vite
call :ensure_pg_default
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
:: Show resolved DB (pydantic: environment shadows .env). A stale system-wide
:: DATABASE_URL=sqlite looks exactly like "run.bat ignores .env".
if exist .venv\Scripts\python.exe .venv\Scripts\python.exe scripts\db_info.py
.venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --no-access-log --timeout-keep-alive 30
goto :eof

:act_tunnel
:: РўСѓРЅРЅРµР»СЊРЅС‹Р№ quick-URL СЃР»СѓС‡Р°РµРЅ РїСЂРё РєР°Р¶РґРѕРј СЂРµСЃС‚Р°СЂС‚Рµ вЂ” СЏРІРЅРѕ РїРµСЂРµС‡РёСЃР»РёС‚СЊ РµРіРѕ
:: РІ CORS_ORIGINS РЅРµР»СЊР·СЏ, РїРѕСЌС‚РѕРјСѓ СЃРµСЂРІРµСЂ РїСѓСЃРєР°РµС‚ *.trycloudflare.com С‡РµСЂРµР·
:: regex. Р СѓС‡РЅСѓСЋ РЅР°СЃС‚СЂРѕР№РєСѓ РЅРµ Р·Р°С‚РёСЂР°РµРј. Р‘РµР· СЌС‚РѕРіРѕ Р±СЂР°СѓР·РµСЂ СЂРµР¶РµС‚ /health Рё
:: API СЃ Vite (http://127.0.0.1:5173) CORS-Р±Р»РѕРєРѕРј.
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
:: http2 (TCP 443) РІРјРµСЃС‚Рѕ QUIC (UDP 7844): QUIC С‡Р°СЃС‚Рѕ СЂРµР¶РµС‚СЃСЏ РїСЂРѕРІР°Р№РґРµСЂРѕРј
:: Рё РїР»РѕС…Рѕ РїСЂРѕС…РѕРґРёС‚ С‡РµСЂРµР· VPN РІ TUN-СЂРµР¶РёРјРµ.
cloudflared tunnel --protocol http2 --url http://localhost:8000
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

:ensure_pg_default
:: Postgres (.env DATABASE_URL, напр. Supabase) имеет приоритет: dev-режимы
:: больше не форсят SQLite. SQLite — только фолбэк, если DATABASE_URL нет
:: ни в окружении, ни в .env (чистый клон без настройки).
:: ВАЖНО: переменную именно НЕ задаём (не пустую!), иначе pydantic возьмёт
:: пустое значение вместо .env.
if defined DATABASE_URL goto :eof
:: NB: no parenthesized block here on purpose: %errorlevel% inside (...)
:: expands at PARSE time (stale value, e.g. leftover choice code 1-6),
:: so the findstr result was never actually tested and SQLite was forced.
if not exist .env goto force_sqlite
findstr /B /C:"DATABASE_URL=" .env >nul 2>&1
if not errorlevel 1 goto :eof
:force_sqlite
set DATABASE_URL=sqlite:///./nurchat.db
echo [..] No DATABASE_URL found - using local SQLite fallback.
goto :eof

:ensure_relay
curl -s -m 2 http://127.0.0.1:8000/health >nul 2>&1
if %errorlevel% equ 0 (
  echo [OK] Relay already on :8000
  exit /b 0
)
:: РџРѕСЂС‚ РјРѕР¶РµС‚ Р±С‹С‚СЊ Р·Р°РЅСЏС‚ "Р·Р°РІРёСЃС€РёРј" РїСЂРѕС†РµСЃСЃРѕРј СЃ РїСЂРѕС€Р»РѕРіРѕ РЅРµСѓРґР°С‡РЅРѕРіРѕ Р·Р°РїСѓСЃРєР°
:: (health РЅРµ РѕС‚РІРµС‡Р°РµС‚, РЅРѕ РїРѕСЂС‚ РІСЃС‘ РµС‰С‘ РґРµСЂР¶РёС‚СЃСЏ) - РѕСЃРІРѕР±РѕР¶РґР°РµРј, РёРЅР°С‡Рµ
:: uvicorn РЅРµ СЃРјРѕР¶РµС‚ Р·Р°Р±РёРЅРґРёС‚СЊСЃСЏ Рё wait_relay Р·Р°РІРёСЃРЅРµС‚ РЅР°РІСЃРµРіРґР°.
:: /T РѕР±СЏР·Р°С‚РµР»РµРЅ: --reload РїРѕРґРЅРёРјР°РµС‚ reloader + РѕС‚РґРµР»СЊРЅС‹Р№ РґРѕС‡РµСЂРЅРёР№
:: server-РїСЂРѕС†РµСЃСЃ, PID РІ netstat - СЌС‚Рѕ reloader, kill Р±РµР· /T СѓР±РёРІР°РµС‚
:: С‚РѕР»СЊРєРѕ РµРіРѕ, Р° РґРѕС‡РµСЂРЅРёР№ РїСЂРѕС†РµСЃСЃ РѕСЃС‚Р°С‘С‚СЃСЏ РІРёСЃРµС‚СЊ РЅР° РїРѕСЂС‚Сѓ.
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /T /PID %%p >nul 2>&1
echo [..] Starting relay in background...
if exist .venv\Scripts\python.exe .venv\Scripts\python.exe scripts\db_info.py
start "NurChat Relay" /B .venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 %RELAY_FLAGS% --no-access-log --timeout-keep-alive 30
set RELAY_STARTED_BY_ME=1
set WAIT_RELAY_TRIES=0
goto wait_relay

:ensure_relay_prod
:: Tunnel-only: доверяем X-Forwarded-For от cloudflared (peer всегда
:: localhost). Без этого request.client.host у всех один и тот же и
:: slowapi-лимиты (30/мин на /chats) становятся ГЛОБАЛЬНЫМИ на всех
:: тестеров за туннелем. Только 127.0.0.1 — XFF-спуфинг извне невозможен.
set RELAY_FLAGS=--proxy-headers --forwarded-allow-ips=127.0.0.1
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
  echo [..] Relay left running ^(was already up^).
  exit /b 0
)
echo [..] Stopping relay on :8000...
for /f "tokens=5" %%p in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do taskkill /F /T /PID %%p >nul 2>&1
set RELAY_STARTED_BY_ME=
goto :eof
