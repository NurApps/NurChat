@echo off
REM NurChat home relay launcher (Windows, always-on).
REM Usage:
REM   scripts\relay-home.bat           - relay only (LAN)
REM   scripts\relay-home.bat tunnel    - relay + Cloudflare quick tunnel (internet)
REM For autostart: Task Scheduler -> At log on -> this file.
cd /d "%~dp0.."

if not exist logs mkdir logs

echo [NurChat] Starting relay on 0.0.0.0:8000 (prod flags, no --reload)...
start "nurchat-relay" /min .venv\Scripts\python.exe -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --log-level info --no-access-log

REM Wait for relay to boot before opening the tunnel
timeout /t 8 >nul

if /i "%1"=="tunnel" (
  echo [NurChat] Starting Cloudflare quick tunnel...
  echo [NurChat] NOTE: quick-tunnel URL changes on every restart.
  echo [NurChat] For a stable address use a named tunnel (see DEPLOY.md).
  cloudflared tunnel --url http://localhost:8000
) else (
  echo [NurChat] Relay running in background window "nurchat-relay".
  echo [NurChat] Server logs: logs\nurchat.log
  echo [NurChat] To expose to internet: scripts\relay-home.bat tunnel
)
