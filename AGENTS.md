# AGENTS.md

## What This Is

NurChat — анонимный мессенджер по модели «общий глухой relay». Tauri v2 desktop app (React + Rust frontend, FastAPI + SQLite backend). AGPL-3.0.

Пользователи НЕ запускают свой сервер: один публичный relay (FastAPI) обслуживает всех, а идентичность определяется локальной парой ключей (анонимный вход без пароля). Privat keys хранятся только на устройстве.

## Quick Start

```bash
# Relay (нужен ОДИН экземпляр для всех; для разработки можно локально):
# Terminal 1 — relay
.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Tauri (handles Vite + Rust build automatically)
npx tauri dev
```

**Critical:** `npx tauri dev` does NOT start the FastAPI relay. A relay must be running separately (or the app must point to a remote one via `VITE_API_HOST`). Without it, frontend shows "Сервер недоступен".

## Commands

| Action | Command |
|--------|---------|
| Relay only | `.venv\Scripts\python -m uvicorn server.main:app --port 8000 --reload` |
| Relay via Docker | `docker-compose up -d` |
| Tauri dev | `npx tauri dev` |
| Frontend build | `cd frontend && npm run build` |
| Frontend dev server | `cd frontend && npm run dev` (port 5173) |
| Python tests | `pytest test/ -v` |
| Python lint | `ruff check .` |
| Python typecheck | `mypy .` |
| Frontend lint | `cd frontend && npm run lint` |
| Tauri build (installer) | `npx tauri build` |

## Known Issues & Workarounds

1. **ENCRYPTION_KEY / JWT_SECRET_KEY not set.** Both auto-generate if empty in `.env`, but temp keys mean data loss / session reset on restart. **Must set stable values in `.env` for production.**

2. **UnicodeEncodeError in Windows console.** Fixed: logger uses `sys.stdout.reconfigure(errors='replace')` — non-ASCII chars (emoji, Cyrillic, etc.) are replaced with `?` instead of crashing.

3. **CORS origins.** Defaults to `localhost:5173, localhost:8000, tauri://localhost, https://tauri.localhost`. Override via `CORS_ORIGINS` env var (comma-separated). No wildcard `*` even in DEBUG.

4. **Server dies when terminal closes.** `start.bat` runs server in background with `start /B`. Use `taskkill /f /im python.exe` to stop.

## Architecture

```
Tauri (Rust) ── wraps ──> React frontend ── HTTP/WS ──> FastAPI relay ──> SQLite
                               │                              │
                               └── IPC commands ──────────────┘
```

- **Frontend:** React 19 + Vite 8 + TypeScript 6 + CSS modules (custom properties)
- **Backend:** FastAPI + SQLAlchemy + SQLite (`nurchat.db`)
- **Desktop:** Tauri v2 (Rust shell, WebView2 on Windows)
- **Migrations:** Alembic (fallback to `create_all` if not configured)
- **File storage:** Local `media/` directory (no cloud)

## Non-Obvious Quirks

1. **Token in query params for media.** `<img>`, `<audio>`, `<video>` can't send Authorization headers. All file URLs use `?token=...`. Frontend `api.getFileUrl()` handles this.

2. **Token in WS query param.** WebSocket at `/ws/chat/{user_id}?token=...` — JWT verified from query string, not header.

3. **Python imports are absolute from repo root.** `server/main.py` adds repo root to `sys.path`. Use `from shared.config import settings`, `from server.core.models import User`, etc.

4. **`config.py` auto-creates dirs on import.** `media/`, `logs/`, `legal/` are created at module load time.

5. **`ENCRYPTION_KEY` and `JWT_SECRET_KEY` auto-generate if not set.** Data encrypted with auto-generated keys won't survive restarts. Set stable values in `.env`.

6. **CORS uses whitelist, not wildcard.** Default: `localhost:5173, localhost:8000, tauri://localhost, https://tauri.localhost`. Even in DEBUG mode, no wildcard `*`.

7. **Frontend env vars use `VITE_` prefix.** Set in shell or `.env`, not in `frontend/.env`. Key vars: `VITE_API_HOST`, `VITE_API_PROTOCOL`.

8. **Supabase/Firebase fully removed.** All storage is local. No cloud dependencies.

9. **Anonymous identity, no passwords.** `POST /api/auth/anonymous` hashes the public key → deterministic `user_id` (`user_{sha256}`) and username (`anon_{...}`). Same key = same user (idempotent). No password/captcha/2FA.

10. **Tray icon.** App minimizes to system tray on close. Click tray icon to show, click "Выйти" in tray menu to quit. Frontend `invoke("minimize_to_tray")` hides the window.

11. **E2E storage key is `device_secret`, not token.** `_deriveStorageKey()` in `e2e.ts` uses a stable `device_secret` in localStorage because the anonymous token changes on every login — using it would break decryption across restarts.

12. **P2P Sharing via `nurchat://`.** Invite URIs: `nurchat://IP:PORT/USER_ID#HASH`. Direct WebSocket connection server-to-server. NAT relay fallback if direct connection fails.

13. **LAN discovery via UDP multicast.** `239.255.43.21:8002` — `/api/discover/lan` scans local network. "Найти в локальной сети" button in P2P page.

14. **Onboarding wizard.** Shown on first launch (4 steps). Dismissed with `localStorage.onboarding_seen`.

15. **ErrorBoundary.** Catches React render errors, shows friendly error page with reload button.

## Env Variables

Required in `.env`:
```
ENCRYPTION_KEY=<stable hex key>
JWT_SECRET_KEY=<stable hex key>
```

Optional:
```
USE_P2P=true
```

Full reference: `.env.example` and `shared/config.py`.

## Auto-Update (Tauri Updater)

- Uses `tauri-plugin-updater` + `tauri-plugin-process` (Rust) and `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` (frontend).
- Checks GitHub releases via `latest.json` manifest published by `tauri-action@v0` in `.github/workflows/release.yml`.
- `UpdateBanner.tsx` polls every launch (10s delay), shows version, downloads with progress, installs, relaunches.

**Signing (required for release builds):**
- Public key is embedded in `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- Private key lives in `update_key_private.key` (gitignored, minisign format).
- GitHub Secrets (must be set for the release workflow to build):
  - `TAURI_SIGNING_PRIVATE_KEY` — contents of `update_key_private.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — empty (key has no password)
- `tauri build` fails without the private key env var; that's expected. `tauri dev` doesn't need it.
- To regenerate a key if lost: `npx tauri signer generate --ci -w update_key_private.key` then copy `.pub` value into `tauri.conf.json`.

## Testing

- Test dir: `test/` (singular, not `tests/`)
- Run: `pytest test/ -v`
- Frontend tests: `cd frontend && npx vitest run` (5 tests in `frontend/src/test/api.test.ts`)
- Key test files: `test/test_crypto.py`, `test/test_security.py`, `test/test_double_ratchet.py`

## Encryption Architecture

NurChat implements **Double Ratchet** (Signal Protocol) for E2E encryption:

- **X3DH** — initial key agreement with identity keys, signed pre-keys, and one-time pre-keys
- **Double Ratchet** — continuous key rotation on every message
- **Forward secrecy** — old keys destroyed after each ratchet step
- **Replay protection** — message IDs tracked per session

```
shared/double_ratchet.py              ← Python implementation (server-side tests)
frontend/src/services/doubleRatchet.ts ← TypeScript implementation (browser)
frontend/src/services/e2e.ts           ← Session manager integrating Double Ratchet
server/routes/keys.py                  ← PreKey API endpoints
```

**PreKey lifecycle:**
1. User registers → generates identity keypair (existing `public_key` on `User`)
2. User uploads signed pre-key + one-time pre-keys via `/api/keys/*`
3. Initiator fetches bundle: `GET /api/keys/bundle/{user_id}`
4. After X3DH, one-time pre-key is marked `is_used=True`
5. Cleanup: `POST /api/keys/cleanup` removes used pre-keys

**Session state** serialized to `localStorage` (`e2e_sessions`).

## Key Files

**Server entry:** `server/main.py` — FastAPI app, CORS, routes, WS endpoints, lifespan
**Config:** `shared/config.py` — Pydantic Settings, reads `.env`
**Models:** `server/core/models.py` — All SQLAlchemy models (includes `SignedPreKey`, `OneTimePreKey`)
**Auth:** `server/routes/auth.py` — Anonymous login (`/api/auth/anonymous`), legacy register/login, profile, avatar
**Chat:** `server/routes/chat.py` — CRUD, search, reactions, block, export
**Keys:** `server/routes/keys.py` — PreKey bundle, signed/one-time pre-key API
**Files:** `server/routes/files.py` — Upload/download (with `?token=`), delete
**WS manager:** `server/ws/chat_manager.py` — WebSocket connections
**Frontend entry:** `frontend/src/App.tsx` — Route definitions
**API client:** `frontend/src/services/api.ts` — All HTTP calls
**Main page:** `frontend/src/pages/ChatPage.tsx` — Sidebar + chat + WS
**Tauri config:** `src-tauri/tauri.conf.json` — App metadata, CSP, build settings

## Conventions

- Russian language in UI and commit messages
- All API responses are JSON (Pydantic models)
- WebSocket events use `{"type": "event_name", ...}` format
- File IDs use `file_` prefix, message IDs use `msg_`, user IDs use `user_`
- Messages in DB store `content` as plaintext or `"[encrypted]"` for E2E
- Reactions are stored server-side in `MessageReaction` table (not ephemeral)
