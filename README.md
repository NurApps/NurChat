<p align="center">
  <img src="frontend/public/icon.png" width="120" alt="NurChat Logo">
</p>

<h1 align="center">NurChat</h1>

<p align="center">
  Анонимный десктопный мессенджер со сквозным шифрованием.<br>
  Без телефона, без email — только username и пароль.
</p>

<p align="center">
  <a href="#возможности">Возможности</a> ·
  <a href="#установка">Установка</a> ·
  <a href="#разработка">Разработка</a> ·
  <a href="#безопасность">Безопасность</a> ·
  <a href="#docker-comparepose">Docker</a> ·
  <a href="#архитектура">Архитектура</a> ·
  <a href="#protocol">Протокол</a> ·
  <a href="#license">Лицензия</a>
</p>

---

## Возможности

### 🔐 Безопасность

- **E2E шифрование** — X3DH (3 DH, без one-time prekey) + Double Ratchet, обязательные Ed25519-подписи
- **Групповое E2E** — симметричный ключ группы, обёрнутый per-user через ECDH, rekey при смене состава
- **E2E-файлы** — байты файлов/голосовых шифруются отдельным per-file ключом, релей хранит только ciphertext
- **E2E-звонки** — SDP/ICE шифруются (ECDH + secretbox), медиа идёт напрямую по WebRTC (DTLS-SRTP)
- **TOTP 2FA** — двухфакторная аутентификация с резервными кодами
- **CAPTCHA** — защита от ботов при регистрации
- **Ротация ключей** — с уведомлением контактов
- **Safety Numbers** — сверка отпечатков ключей для защиты от MITM

### 🕵️ Приватность

- **Без телефона и email** — регистрация только по username/паролю
- **Глухой relay** — сервер хранит только шифротекст, содержимое сообщений удаляется после доставки (`RELAY_DEAF=true`)
- **Эфемерные сообщения** — авто-удаление по таймеру, view-once
- **PIN-код** — блокировка приложения

### 📺 Медиа

- **Голосовые сообщения** — запись и воспроизведение
- **Видео-кружки** — короткие видео
- **Файлы** — загрузка с MIME-проверкой, опциональный ClamAV-скан
- **Превью ссылок** — превью страниц в сообщениях

### 👥 Группы

- **Создание групп** — выбор участников, имя группы
- **Админы** — управление участниками, инвайт-ссылки
- **Мут/пин** — отключение уведомлений, закрепление чатов

### 📞 Звонки

- **Аудио/видео 1:1** — WebRTC через WebSocket-сигналинг, STUN/TURN
- **Переключение камер, демонстрация экрана**
- **ICE restart** — авто-восстановление при обрыве
- **История звонков** (опционально, выключаема флагом `CALLS_MINIMAL_METADATA`)

### 💾 Бэкапы

- **Зашифрованные бэкапы** — экспорт чатов и ключей, защищён паролем (AES-256-GCM)
- **Восстановление** — импорт данных на другом устройстве

### ✨ Удобство

- **Тёмная/светлая тема** — авто-определение
- **Поиск** — глобальный поиск по сообщениям
- **Закладки, пересылка, inline-редактирование, реакции**
- **Push-уведомления** (Web Push/VAPID), автообновления (Tauri updater)

---

## Установка

### Десктоп (Windows)

1. Скачайте `NurChat_*_x64-setup.exe` с [Releases](https://github.com/NurApps/NurChat/releases)
2. Запустите установщик
3. Укажите адрес relay (свой или полученный от друга) — приложение подключится к нему

**Системные требования:** Windows 10+ (WebView2 обычно уже встроен), ~200 МБ свободного места.

### Relay (сервер) — Docker

```bash
git clone https://github.com/NurApps/NurChat.git
cd NurChat
cp .env.example .env
# отредактируйте .env: ENCRYPTION_KEY, JWT_SECRET_KEY, TOTP_MASTER_KEY (см. AGENTS.md)
docker compose up -d --build
docker compose exec nurchat alembic upgrade head
curl -f http://localhost:8000/health
```

Публичный инстанс с HTTPS и хардненным конфигом — см. `DEPLOY.md`.

---

## Разработка

```bash
git clone https://github.com/NurApps/NurChat.git
cd NurChat

# Python venv
python -m venv .venv
.venv\Scripts\activate       # Windows; macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Миграции
.venv\Scripts\python -m alembic upgrade head

# Терминал 1 — relay (обязательно отдельно, `npx tauri dev` его не поднимает)
run.bat relay
# или напрямую:
.venv\Scripts\python -m uvicorn server.main:app --port 8000 --reload

# Терминал 2 — Tauri
npx tauri dev
```

Без запущенного relay фронтенд покажет «Сервер недоступен» — укажите `VITE_API_HOST`/`VITE_API_PROTOCOL` для удалённого relay.

**Требования:** Python 3.12, Node.js 22+, Rust, WebView2 (Windows).

### Прочие команды

```bash
# Фронтенд отдельно (без Tauri), порт 5173
cd frontend && npm run dev

# Сборка installer'а
npx tauri build

# Тесты
pytest test/ -v
cd frontend && npx vitest run

# Линт / типчек
ruff check . && mypy .
cd frontend && npm run lint && npx tsc --noEmit
```

Структура проекта, ключевые файлы и известные особенности кода — см. `AGENTS.md`.

---

## Безопасность

Что реализовано:

| Компонент | Реализация |
|---|---|
| Протокол | X3DH (3 DH, без one-time prekey) + Double Ratchet, Ed25519-подписи обязательны |
| Шифры | XSalsa20-Poly1305 / AES-256-GCM, X25519 ECDH |
| Примитивы | `@noble/curves` + `@noble/ciphers` (аудит cure53, 09.2024) |
| Post-compromise security | DH-ратчет самовосстанавливает сессию после компрометации ключа |
| Аутентификация сервера | Argon2id, JWT с ротацией, TOTP 2FA |
| Хранение ключей на устройстве | IndexedDB + AES-256-GCM, PBKDF2 100k, автоочистка через 10 мин |

Чего у нас **нет** — говорим честно:

- **Внешнего аудита.** Реализация протокола своя: схема проверена годами в Signal, но в нашей реализации возможны ошибки.
- **Формальной верификации** протокола (Tamarin/ProVerif).
- **One-time prekeys в X3DH.** Клиент намеренно использует только 3 DH — стандартный Signal-fallback, чуть слабее forward secrecy первого сообщения.
- **Защиты метаданных.** Relay видит, кто с кем и когда общается (граф, размер сообщений с точностью до бакета). Содержимое не хранит: доставленные сообщения удаляются строками (`RELAY_DEAF=true` по умолчанию), история живёт только на устройствах.
- **Аппаратной защиты ключей** — `device_secret` лежит открытым в IndexedDB (в браузере нет OS keystore). Поднимает планку против кражи из localStorage, но полный дамп IndexedDB всё вскрывает.
- **Групповой ratchet — свой велосипед** (hash-chain, не Sender Keys): работает, но не рецензирован криптографами.

Полная честная картина (что реально E2E, а что нет) — `docs/E2E_AND_TRANSPORT.md`.

Если найдёте уязвимость — [сообщите](https://github.com/NurApps/NurChat/security/advisories/new), см. `SECURITY.md`.

> Мы не используем слова «военная криптография». Скептицизм полезнее доверия: читайте код, тестируйте, сообщайте о проблемах.

---

## Docker Compose

```bash
docker-compose up -d          # запуск всех сервисов
docker-compose logs -f nurchat
docker-compose down           # остановка
docker-compose down -v        # полная очистка (удалит все данные!)
```

| Сервис | Порт | Описание |
|--------|------|----------|
| `nurchat` | 8000 | FastAPI relay |
| `db` | 5432 | PostgreSQL 15 |
| `redis` | 6379 | Redis 7 (rate-limiting, presence, WS pub/sub) |

Ключевые переменные `.env` (полный список — `.env.example`, `shared/config.py`):

```ini
DATABASE_URL=sqlite:///./nurchat.db   # локально; Docker: postgresql://nurchat:nurchat_pass@db:5432/nurchat
USE_REDIS=false
ENCRYPTION_KEY=<hex 64>               # openssl rand -hex 32
JWT_SECRET_KEY=<hex 64>
TOTP_MASTER_KEY=<token_urlsafe 32>
CORS_ORIGINS=http://localhost:5173,tauri://localhost,https://tauri.localhost
```

Миграции применяются вручную: `docker-compose exec nurchat alembic upgrade head`.

Health check: `curl http://localhost:8000/health` → `{"status":"healthy"}`.

Продакшен-развёртывание, харднинг, бэкапы, TURN, мониторинг — целиком в `DEPLOY.md`.

---

## Архитектура

```
Tauri (Rust shell) ── wraps ──> React frontend ── HTTP/WS ──> FastAPI relay ──> SQLite/PostgreSQL
```

Relay — слепой курьер: передаёт зашифрованные сообщения, но прочитать их не может (ключи существуют только на устройствах собеседников).

- **Десктоп:** SQLite (встроенный, без настройки)
- **Docker/Production:** PostgreSQL + Redis (через docker-compose)
- **База:** SQLAlchemy ORM, миграции через Alembic
- **Real-time:** WebSocket — `/ws/chat`, `/ws/calls`, `/ws/signaling`, `/ws/notifications`
- **Звонки:** WebRTC, сигналинг через WebSocket, NAT — STUN/TURN (coturn в compose)
- **Файлы:** локальное хранилище в `media/`, шифротекст, TTL-очистка по расписанию (по умолчанию 30 дней)

P2P-транспорт (прямая передача сообщений между устройствами) и IPFS в ядре отсутствуют — были удалены в 2026-09 как нерабочий мёртвый код (подробности — `docs/E2E_AND_TRANSPORT.md` §7). Флаг `USE_FEDERATION` в коде есть, но выключен по умолчанию и на сегодня нефункционален (модуль сервер-к-серверу ещё не реализован) — не полагайтесь на него.

---

## Protocol

NurChat использует X3DH (3 DH, подписи Ed25519 обязательны) + Double Ratchet для 1:1-чатов — тот же класс протокола, что в Signal, реализованный самостоятельно (без внешнего аудита, см. раздел «Безопасность»). Групповые чаты используют обёрнутый симметричный ключ с собственной hash-chain ratchet-схемой (не Sender Keys).

Подробное, доказанное кодом описание протокола, транспорта и того, что relay видит/не видит — `docs/E2E_AND_TRANSPORT.md`.

---

## License

[GNU AGPL v3](LICENSE) © NurApps 2026
