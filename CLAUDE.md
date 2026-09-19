# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Primary reference

**`AGENTS.md` in the repo root is the authoritative, actively-maintained architecture doc — read it first.** It covers the E2E protocol, WS event formats, quirks proven by code (session ratchet direction, `call-join` auto-accept, X3DH without OPK, etc.), key file map, and conventions. This file only adds what AGENTS.md doesn't spell out: exact test invocation and a couple of stack notes from README.md.

Do not trust `README.md` for architecture — it still describes removed P2P/IPFS features. `AGENTS.md` reflects the current, honest state (P2P core removed 2026-09, see `docs/E2E_AND_TRANSPORT.md` §7).

## Commands

```bash
# Everything (menu): dev | vite | relay | tunnel | build | checks
run.bat

# Relay must run separately — `npx tauri dev` does NOT start it
run.bat relay                                            # terminal 1
npx tauri dev                                             # terminal 2

# Relay manually (equivalent to run.bat relay)
python -m uvicorn server.main:app --port 8000 --reload

# DB migrations
alembic upgrade head

# Frontend only (no Tauri), port 5173
cd frontend && npm run dev

# Frontend build / installer
cd frontend && npm run build
npx tauri build

# Python tests (all)
pytest test/ -v
# Single file / single test
pytest test/test_double_ratchet.py -v
pytest test/test_double_ratchet.py::test_name -v

# Python lint / typecheck
ruff check .
mypy .

# Frontend tests / lint / typecheck
cd frontend && npx vitest run
cd frontend && npx vitest run src/test/api.test.ts   # single file
cd frontend && npm run lint
cd frontend && npx tsc --noEmit
```

Without the relay running on `:8000` (or a remote one via `VITE_API_HOST`), the frontend shows "Сервер недоступен".

## Stack

- **Frontend:** React 19 + TypeScript + Vite 8, Zustand (state), React Router 7, i18next, TweetNaCl/@noble (client-side E2E), Vitest
- **Relay:** FastAPI 0.135 + SQLAlchemy 2.0 + Alembic; SQLite by default, PostgreSQL 15 + Redis via `docker-compose`; Argon2 (passwords), python-jose (JWT), PyOTP (TOTP)
- **Desktop:** Tauri 2.11 (Rust shell, WebView2 on Windows)

## Architecture, conventions, and known quirks

See `AGENTS.md` — in particular its "Non-Obvious Quirks (доказанные кодом)" section before touching E2E, WebSocket, or call-signaling code. Key points not to relearn the hard way:

- Two WS message shapes coexist by design: chat WS uses `{"event": ...}`, signaling WS uses `{"type": ...}` — don't unify without updating both clients.
- Group chats always use `groupE2E.ts` (symmetric key wrapped per-user); 1:1 uses Double Ratchet (`e2e.ts`) — do not swap.
- Own outgoing messages are cryptographically unreadable from history (Double Ratchet sending ≠ receiving key); plaintext comes from `plaintextCache.ts`, not decryption.
- Python imports are absolute from repo root (`from shared.config import settings`), never relative.
- No new encryption/transport systems next to the existing core — fix the core instead.
