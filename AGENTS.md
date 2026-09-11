# AGENTS.md

## What This Is

NurChat — мессенджер на модели «глухой relay + E2E». Tauri v2 desktop app (React + Rust shell, FastAPI relay + SQLite). AGPL-3.0.

Пользователи НЕ запускают свой сервер: один публичный relay (FastAPI) обслуживает всех, идентичность — локальная пара ключей на устройстве. Приватные ключи устройство не покидают. P2P-транспорта в ядре НЕТ (удалён 2026-09 как мёртвый код — см. `docs/E2E_AND_TRANSPORT.md`, раздел 7).

## Quick Start

```bash
# One-click (Windows):
start.bat

# Manual:
# Terminal 1 — relay (ОБЯЗАТЕЛЬНО отдельно: `npx tauri dev` сервер НЕ поднимает)
.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload

# Terminal 2 — Tauri (Vite + Rust собирает сам)
npx tauri dev
```

Без релея на `:8000` (или удалённого через `VITE_API_HOST`) фронтенд показывает «Сервер недоступен».

## Commands

| Action | Command |
|--------|---------|
| Start everything | `start.bat` |
| Relay only | `.venv\Scripts\python -m uvicorn server.main:app --port 8000 --reload` |
| Relay via Docker | `docker-compose up -d` |
| Tauri dev | `npx tauri dev` |
| Frontend build | `cd frontend && npm run build` |
| Frontend dev only | `cd frontend && npm run dev` (port 5173) |
| Python tests | `pytest test/ -v` |
| Python lint | `ruff check .` |
| Python typecheck | `mypy .` |
| Frontend lint | `cd frontend && npm run lint` |
| Frontend tests | `cd frontend && npx vitest run` |
| Tauri build (installer) | `npx tauri build` |

## Known Issues & Workarounds

1. **ENCRYPTION_KEY / JWT_SECRET_KEY / TOTP_MASTER_KEY not set.** Автогенерятся при пустом `.env`, но временные ключи = потеря данных / разлогин всех при рестарте. Для продакшена — стабильные значения в `.env`.
2. **UnicodeEncodeError in Windows console.** Fixed: `sys.stdout/stderr.reconfigure(errors='replace')` в `shared/config.py`.
3. **CORS origins.** По умолчанию `localhost:5173, localhost:8000, tauri://localhost, https://tauri.localhost`. Прод-домен — через `CORS_ORIGINS` (comma-separated). Wildcard `*` нет даже в DEBUG. CSP собирается из того же whitelist — см. `server/main.py: add_security_headers`.
4. **Server dies when terminal closes.** `start.bat` держит сервер через `start /B`. Остановка: `taskkill /f /im python.exe`.
5. **Звонки за NAT не соединяются без TURN.** По умолчанию только Google STUN. Прод: coturn (`infra/coturn.conf`) + `TURN_USERNAME`/`TURN_CREDENTIAL` в `.env`. Сервер пишет warning в лог, если TURN не настроен.
6. **`PUBLIC_RELAYS` пуст.** `frontend/src/config.ts` — некуда резолвиться, клиенты default'ят на `127.0.0.1:8000`. Вписать свой relay при деплое.

## Architecture

```
Tauri (Rust shell) ── wraps ──> React frontend ── HTTP/WS ──> FastAPI relay ──> SQLite
                                        │                              │
                                        └── Tauri IPC (tray, файлы) ───┘
```

- **Frontend:** React 19 + Vite 8 + TypeScript + CSS modules
- **Relay:** FastAPI + SQLAlchemy + SQLite (`nurchat.db`), глухой режим `RELAY_DEAF=true`
- **Desktop:** Tauri v2 (Rust, WebView2 на Windows)
- **Migrations:** Alembic (fallback на `create_all`)
- **Файлы:** локальный `media/`, байты ОТКРЫТО (не E2E; случайные имена, EXIF счищается, TTL 30 дней), но caption вложения шифруется E2E (`handleSendAttachment` в `useChatActions.ts`)
- **Звонки:** сигналинг через relay WS, медиа — WebRTC напрямую между устройствами (настоящий P2P, сервер медиа не касается)

Полная честная картина: `docs/E2E_AND_TRANSPORT.md`.

## Non-Obvious Quirks (доказанные кодом)

1. **Token в query для медиа и WS.** `<img>/<audio>/<video>` и WebSocket не умеют Authorization-заголовки: файлы — `?token=`, сокеты — `/ws/chat/{user_id}?token=`. JWT сверяется с `sub == user_id`. Mitigations: только `wss/https` в проде, короткий TTL.
2. **WS-эндпоинты (4 штуки):** `/ws/chat/{user_id}` — сообщения (`{"event": ...}`), `/ws/calls/{user_id}` и `/ws/signaling/{user_id}` — синонимы сигналинга (`{"type": ...}`), `/ws/notifications/{user_id}` — уведомления. Лимит 10 соединений/IP, 1 МБ/сообщение, ping при простое 120с, разрыв после 300с тишины.
3. **Форматы событий разные — это нормально:** chat-WS шлёт `{"event": ...}`, signaling-WS — `{"type": ...}`. Не «унифицировать» без обновления обоих клиентов (`useChatSocket.ts`, `CallPage.tsx`).
4. **Python imports — абсолютные от корня репо.** `from shared.config import settings`, `from server.core.models import User`.
5. **`shared/config.py` — без P2P-флагов.** `USE_P2P`, `P2P_*`, `USE_IPFS`, `USE_FEDERATED_BACKUP` удалены 2026-09 (код их не читал). Живой флаг федерации — `USE_FEDERATION`. Дубли `SERVER_HOST/DEBUG/CLIENT_HOST` вычищены.
6. **CORS — whitelist, CSP — из него же.** Даже в DEBUG нет `*`.
7. **Frontend env — только `VITE_` префикс** (shell/корневой `.env`, не `frontend/.env`). Ключи: `VITE_API_HOST`, `VITE_API_PROTOCOL`. `BASE_URL/WS_BASE` заморожены на старте модуля — смена релея требует перезагрузки.
8. **Supabase/Firebase удалены полностью.** Только локальное хранение.
9. **Tray icon.** Close сворачивает в трей (`minimize_to_tray`); выход — «Выйти» в меню трея.
10. **E2E-ключ хранилища — `device_secret`, не токен.** `deriveStorageKey()` в `e2e.ts`: токен меняется при каждом логине, шифровать им сессии нельзя. Честное ограничение: `device_secret` лежит в IndexedDB открытым текстом (в браузере нет OS-keystore) — см. шапку `secureStorage.ts`.
11. **X3DH — 3 DH, без OPK.** В протоколе нет OPK id, клиент осознанно игнорирует `bundle.one_time_prekey` (иначе первое сообщение не расшифровать). Сервер OPK при выдаче помечает использованным (безвредная трата, догрузка при <20).
12. **Маршрутизация E2E:** групповой чат ВСЕГДА шифруется групповым ключом (`groupE2E.ts`), личка — 1-1 Double Ratchet (`e2e.ts`). Не менять порядок без понимания (был баг наоборот).
13. **Сессии — в IndexedDB (`nurchat-secure`), НЕ в localStorage.** AES-256-GCM, PBKDF2 100k, автоочистка кэша через 10 мин неактивности.
14. **Onboarding wizard.** 4 шага, гасится `localStorage.onboarding_seen`.
15. **ErrorBoundary.** Ловит ошибки рендера React, показывает страницу с кнопкой reload.
16. **P2P НЕ возвращать.** TCP-нода (`src-tauri/src/p2p.rs`), LAN discovery, `nurchat://`, `USE_P2P` — удалены как нерабочие. Остатки: `p2pchat/` (прототип, не импортируется), таблицы `p2p_*` в миграции 001 (история), `src-tauri/src/ipfs.rs` (мёртвый импорт). Рабочий P2P остался только в WebRTC-медиа звонков.

## Env Variables

Обязательные в `.env`:
```
ENCRYPTION_KEY=<stable hex key>
JWT_SECRET_KEY=<stable hex key>
TOTP_MASTER_KEY=<stable secret>
```

Прод связи/звонков:
```
CORS_ORIGINS=https://relay.example.com
TURN_USERNAME=nurchat
TURN_CREDENTIAL=<из infra/coturn.conf>
# или JSON целиком:
# WEBRTC_ICE_SERVERS=[{"urls":"turn:...","username":"...","credential":"..."}]
VITE_API_HOST=relay.example.com
VITE_API_PROTOCOL=https
```

Полный референс: `.env.example` и `shared/config.py`.

## Auto-Update (Tauri Updater)

- `tauri-plugin-updater` + `tauri-plugin-process` (Rust) и `@tauri-apps/plugin-updater` + `@tauri-apps/plugin-process` (frontend).
- `UpdateBanner.tsx` опрашивает GitHub releases через `latest.json` (публикует `tauri-action@v0` в `.github/workflows/release.yml`), задержка 10с после старта.
- Публичный ключ в `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`; приватный — `update_key_private.key` (gitignored). Секреты CI: `TAURI_SIGNING_PRIVATE_KEY` (+ пустой `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). `tauri build` без ключа падает — ожидаемо; `tauri dev` ключ не нужен.

## Testing

- Python: `pytest test/ -v` (директория `test/`, singular). Ключевые: `test_double_ratchet.py`, `test_crypto.py`, `test_security.py`.
- Frontend: `cd frontend && npx vitest run` (`frontend/src/test/api.test.ts`).
- После правок транспорта/E2E: обязательно `ruff check .` + `mypy .` + `cd frontend && npm run lint`.

## Encryption Architecture (кратко; полно — в docs/)

X3DH (3 DH, подписи Ed25519 обязательны) + Double Ratchet. Лички: `e2e.ts` + `doubleRatchet.ts` (+ Python-зеркало `shared/double_ratchet.py` для тестов). Группы: `groupE2E.ts` (симметричный ключ, завёрнут per-user через ECDH; сервер хранит только завёрнутые копии в `Chat.group_key`). PreKey API: `server/routes/keys.py`. Relay принимает только `encrypted_content` (`content="[encrypted]"`), иначе 400/отброс.

## Key Files

**Relay entry:** `server/main.py` — app, CORS/CSP, rate limits, WS-эндпоинты, lifespan
**Config:** `shared/config.py` — Pydantic Settings, читает корневой `.env`
**Models:** `server/core/models.py` — все SQLAlchemy-модели (включая `SignedPreKey`, `OneTimePreKey`, `CallLog`, `PushSubscription`)
**Auth:** `server/routes/auth.py` — register/login + captcha, 2FA TOTP, ротация E2E-ключей
**Chat:** `server/routes/chat.py` — CRUD, RELAY_DEAF-принуждение, group-key API
**Keys:** `server/routes/keys.py` — SPK/OPK/bundle/cleanup
**Files:** `server/routes/files.py` — upload/download (`?token=`), открытое хранение
**Calls REST:** `server/routes/calls.py` — история, ICE-серверы
**WS chat:** `server/ws/chat_manager.py` — соединения, доставка, presence
**WS calls:** `server/ws/signaling.py` — WebRTC-сигналинг, pending-буфер
**WS push:** `server/ws/notifications.py` + `server/routes/push.py` — VAPID Web Push
**Docs:** `docs/E2E_AND_TRANSPORT.md` — честная документация (читать первой)
**Frontend entry:** `frontend/src/App.tsx`
**API client:** `frontend/src/services/api.ts`
**Relay config:** `frontend/src/config.ts` — резолвинг релея, `BASE_URL`/`WS_BASE`
**E2E:** `frontend/src/services/e2e.ts`, `doubleRatchet.ts`, `groupE2E.ts`, `secureStorage.ts`, `cryptoAdapter.ts`
**WS client:** `frontend/src/hooks/useChatSocket.ts` (чат), `frontend/src/pages/CallPage.tsx` (звонки)
**Отправка/история:** `frontend/src/hooks/useChatActions.ts`, `useChatMessages.ts`
**Main page:** `frontend/src/pages/ChatPage.tsx`
**Tauri:** `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs` (без `mod p2p`)

## Conventions

- Russian language in UI and commit messages
- Все API-ответы — JSON (Pydantic)
- Chat WS: `{"event": "event_name", "data": {...}}`; signaling WS: `{"type": "...", ...}`
- Префиксы ID: `file_`, `msg_`, `user_`
- `content="[encrypted]"` в БД при E2E; конверт — в `encrypted_content`
- Реакции — серверные (`MessageReaction`), не эфемерные
- Не вводить новые системы шифрования/транспорта рядом с ядром — чинить ядро
