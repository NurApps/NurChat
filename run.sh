#!/usr/bin/env bash
# Единый лаунчер NurChat (Linux/macOS). Аналог run.bat.
# Без аргументов — интерактивное меню. С аргументом — прямой режим
# (для скриптов, Tauri beforeDev, cron):
#   ./run.sh dev      - relay (SQLite) + Tauri
#   ./run.sh vite     - relay (SQLite) + Vite (браузер :5173)
#   ./run.sh relay    - только relay, foreground, .env как есть
#   ./run.sh tunnel   - relay (фон, .env как есть) + cloudflared
#   ./run.sh build    - сборка Tauri-пакетов (.deb + .AppImage)
#   ./run.sh checks   - быстрые проверки (ruff + pytest-подмножество)
#
# dev/vite форсируют SQLite, чтобы локальная разработка не упиралась
# в Supabase из .env. relay/tunnel .env НЕ трогают: аккаунты живут
# в настроенной БД, смена БД = потеря аккаунтов.

set -u
cd "$(dirname "${BASH_SOURCE[0]}")"
ROOT="$PWD"
export PYTHONUTF8=1

RELAY_PID=""
RELAY_FLAGS=()

# venv: Linux/macOS (.venv/bin) или Git Bash на Windows (.venv/Scripts); иначе системный python3
if [ -x .venv/bin/python ]; then
  PY=".venv/bin/python"
elif [ -x .venv/Scripts/python.exe ]; then
  PY=".venv/Scripts/python.exe"
else
  PY="$(command -v python3 || command -v python || true)"
fi

need_python() {
  if [ -z "$PY" ]; then
    echo "[!!] Python not found. Create venv: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt"
    return 1
  fi
}

# ============ helpers ============

relay_healthy() {
  curl -s -m 2 http://127.0.0.1:8000/health 2>/dev/null | grep -q healthy
}

# PID'ы, слушающие :8000 (lsof -> fuser -> ss)
port_pids() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -ti tcp:8000 -sTCP:LISTEN 2>/dev/null
  elif command -v fuser >/dev/null 2>&1; then
    fuser 8000/tcp 2>/dev/null | tr -s ' ' '\n' | grep -E '^[0-9]+$'
  else
    ss -ltnp 'sport = :8000' 2>/dev/null | grep -oE 'pid=[0-9]+' | cut -d= -f2
  fi
}

# Освобождаем порт от "зависшего" процесса с прошлого запуска: uvicorn --reload
# поднимает reloader + дочерний server-процесс, поэтому убираем и группу, и PID.
free_port() {
  local pid
  for pid in $(port_pids | sort -u); do
    kill -9 -- "-$pid" 2>/dev/null || true
    kill -9 "$pid" 2>/dev/null || true
  done
}

ensure_relay() {
  need_python || return 1
  if relay_healthy; then
    echo "[OK] Relay already on :8000"
    return 0
  fi
  free_port
  echo "[..] Starting relay in background..."
  # setsid: relay в своей группе процессов, чтобы одним kill убить reloader + child
  setsid "$PY" -m uvicorn server.main:app --host 0.0.0.0 --port 8000 \
    ${RELAY_FLAGS[@]+"${RELAY_FLAGS[@]}"} --no-access-log --timeout-keep-alive 30 &
  RELAY_PID=$!
  local i
  for i in $(seq 1 20); do
    sleep 1
    if relay_healthy; then
      echo "[OK] Relay on http://127.0.0.1:8000"
      return 0
    fi
    if ! kill -0 "$RELAY_PID" 2>/dev/null; then break; fi
  done
  echo "[!!] Relay didn't come up on :8000 in time - aborting."
  stop_relay_if_mine
  return 1
}

ensure_relay_prod() {
  RELAY_FLAGS=()
  ensure_relay
}

stop_relay_if_mine() {
  if [ -z "$RELAY_PID" ]; then
    echo "[..] Relay left running (was already up)."
    return 0
  fi
  echo "[..] Stopping relay on :8000..."
  kill -- "-$RELAY_PID" 2>/dev/null || kill "$RELAY_PID" 2>/dev/null || true
  free_port
  RELAY_PID=""
}

# Ctrl+C / выход не должны оставлять relay висеть на порту (молча, если relay не мой)
cleanup() { local rc=$?; [ -n "$RELAY_PID" ] && stop_relay_if_mine; exit "$rc"; }
trap cleanup EXIT
trap 'exit 130' INT TERM

# ============ actions ============

act_dev() {
  export DATABASE_URL="sqlite:///./nurchat.db"
  RELAY_FLAGS=(--reload)
  ensure_relay || return 1
  echo "[..] Starting Tauri dev..."
  npx tauri dev
  stop_relay_if_mine
}

act_vite() {
  export DATABASE_URL="sqlite:///./nurchat.db"
  RELAY_FLAGS=(--reload)
  ensure_relay || return 1
  echo "[..] Starting Vite (http://localhost:5173)..."
  (cd frontend && npm run dev)
  stop_relay_if_mine
}

act_relay() {
  need_python || return 1
  echo "[..] Relay foreground, .env as-is. Ctrl+C to stop."
  "$PY" -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --no-access-log --timeout-keep-alive 30
}

act_tunnel() {
  # Туннельный quick-URL случаен при каждом рестарте — явно перечислить его
  # в CORS_ORIGINS нельзя, поэтому сервер пускает *.trycloudflare.com через
  # regex. Ручную настройку не затираем.
  export CORS_ORIGIN_REGEX="${CORS_ORIGIN_REGEX:-https://[a-z0-9-]+\.trycloudflare\.com}"
  ensure_relay_prod || return 1
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo "[!!] cloudflared not found. Install: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    return 1
  fi
  echo "[..] NOTE: quick-tunnel URL changes on every restart. Stable address = named tunnel."
  # http2 (TCP 443) вместо QUIC (UDP 7844): QUIC часто режется провайдером
  # и плохо проходит через VPN.
  cloudflared tunnel --protocol http2 --url http://localhost:8000
  stop_relay_if_mine
}

act_build() {
  local conf="src-tauri/tauri.conf.json"
  local bak="src-tauri/tauri.conf.json.bak-run"
  # На Linux в конфиге нет валидной цели nsis — явно просим deb + appimage
  local bundles="deb,appimage"

  if [ -s update_key_private.key ] && [ "$(wc -c < update_key_private.key)" -gt 50 ]; then
    echo "[OK] Signing key found - signed build with updater."
    TAURI_SIGNING_PRIVATE_KEY="$(cat update_key_private.key)"
    export TAURI_SIGNING_PRIVATE_KEY
    export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
    npx tauri build --bundles "$bundles"
    return $?
  fi

  echo "[..] No signing key - unsigned build (updater section stripped temporarily, config restored after)."
  cp -f "$conf" "$bak"
  # восстановим конфиг при любом исходе, включая Ctrl+C
  trap 'rc=$?; mv -f "$bak" "$conf" 2>/dev/null; [ -n "$RELAY_PID" ] && stop_relay_if_mine; exit $rc' EXIT
  node -e "const fs=require('fs');const p='$conf';const c=JSON.parse(fs.readFileSync(p,'utf8'));delete c.plugins.updater;fs.writeFileSync(p,JSON.stringify(c,null,2));"
  npx tauri build --bundles "$bundles"
  local rc=$?
  mv -f "$bak" "$conf"
  trap cleanup EXIT
  return $rc
}

act_checks() {
  need_python || return 1
  echo "[..] ruff..."
  "$PY" -m ruff check . || return 1
  echo "[..] pytest (fast subset)..."
  "$PY" -m pytest test/test_call_join_accept.py test/test_deaf_calls.py -q
}

dispatch() {
  case "$(printf %s "$1" | tr A-Z a-z)" in
    dev)    act_dev ;;
    vite)   act_vite ;;
    relay)  act_relay ;;
    tunnel) act_tunnel ;;
    build)  act_build ;;
    checks) act_checks ;;
    *)
      echo "Unknown mode \"$1\". Use: dev | vite | relay | tunnel | build | checks"
      return 1
      ;;
  esac
}

menu() {
  while true; do
    clear
    echo "========================================"
    echo "  NurChat — launcher"
    echo "========================================"
    echo
    echo "  1) Dev full       relay (SQLite) + Tauri app"
    echo "  2) Frontend       relay (SQLite) + Vite (browser :5173)"
    echo "  3) Relay only     foreground, .env as-is"
    echo "  4) Relay + tunnel relay (bg) + cloudflared -> internet"
    echo "  5) Build          Tauri packages (.deb + .AppImage)"
    echo "  6) Checks         ruff + fast pytest subset"
    echo "  0) Exit"
    echo
    read -r -p "  Select [1-6,0]: " choice
    case "$choice" in
      1) dispatch dev ;;
      2) dispatch vite ;;
      3) dispatch relay ;;
      4) dispatch tunnel ;;
      5) dispatch build ;;
      6) dispatch checks ;;
      0) echo "Bye."; return 0 ;;
      *) continue ;;
    esac
    echo
    read -r -p "Press Enter to continue..." _
  done
}

if [ $# -eq 0 ]; then
  menu
else
  dispatch "$1"
  exit $?
fi
