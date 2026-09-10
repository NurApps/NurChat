<p align="center">
  <img src="frontend/public/icon.png" width="120" alt="NurChat Logo">
</p>

<h1 align="center">NurChat</h1>

<p align="center">
  Анонимный мессенджер со сквозным шифрованием.<br>
  Без телефона, без email — только username и пароль.
</p>

<p align="center">
  <a href="#возможности">Возможности</a> ·
  <a href="#установка">Установка</a> ·
  <a href="#безопасность">Безопасность</a> ·
  <a href="#docker">Docker</a> ·
  <a href="#разработка">Разработка</a>
</p>

---

## Возможности

- **Сквозное шифрование (E2E)** — X3DH (3 DH, без one-time prekey) + Double Ratchet,
  Ed25519-подписи обязательны, safety numbers, ротация ключей с уведомлениями
- **Личные и групповые чаты** — групповой E2E через обёрнутые симметричные ключи
- **Сообщения** — ответы, реакции, редактирование, удаление, эфемерные (TTL),
  view-once, отложенные, экспорт, глобальный поиск
- **Файлы и голосовые** — загрузка с MIME-проверкой, опциональный ClamAV-скан
- **Аудио/видеозвонки 1:1** — WebRTC через WebSocket-сигналинг, STUN/TURN, история звонков
- **Контакты** — заявки в контакты, блокировка, приглашения в группы
- **2FA (TOTP)** с backup-кодами
- **PIN-блокировка** приложения, push-уведомления (Web Push/VAPID), автообновления

## Безопасность

Что реализовано:

| Компонент | Реализация |
|---|---|
| Протокол | X3DH (3 DH) + Double Ratchet, Ed25519-подписи обязательны |
| Шифры | XSalsa20-Poly1305 / AES-256-GCM, X25519 ECDH |
| Примитивы | @noble (аудит cure53), WebCrypto для KDF |
| Post-compromise security | DH-ratchet самовосстанавливает сессию после компрометации ключа |
| Replay protection | Отслеживание message ID per session |
| Аутентификация сервера | Argon2id, JWT c отзывом и ротацией, TOTP 2FA |
| Хранение ключей | IndexedDB + AES-256-GCM, zeroize, автоочистка через 10 мин |

Чего у нас **нет** — говорим честно:

- **Внешнего аудита.** Код не проверялся независимыми аудиторами. Реализация
  протокола своя: схема проверена годами в Signal, но в нашей реализации
  возможны ошибки.
- **Формальной верификации** протокола (Tamarin/ProVerif).
- **One-time prekeys в X3DH.** Клиент намеренно использует только 3 DH
  (в протоколе нет OPK id) — стандартный Signal-fallback, чуть слабее forward
  secrecy первого сообщения.
- **Защиты метаданных.** Релей видит, кто с кем и когда общается.
  Содержимое не хранит: доставленные сообщения удаляются строками
  (`RELAY_DEAF=true` по умолчанию), история живёт только на устройствах.
- **Аппаратной защиты ключей** — `device_secret` лежит открытым в IndexedDB
  (в браузере нет OS keystore). Поднимает планку против кражи localStorage,
  но дамп IndexedDB всё вскрывает.
- **Групповой ratchet — свой велосипед** (hash-chain, не Sender Keys):
  работает, но не рецензирован криптографами.

Если найдёте уязвимость — [сообщите](https://github.com/NurApps/NurChat/security/advisories/new),
мы исправимся быстро.

> Мы не используем слова «военная криптография». Скептицизм полезнее доверия:
> читайте код, тестируйте, сообщайте о проблемах.

## Установка

### Десктоп (Windows)

1. Скачайте `NurChat_*_x64-setup.exe` с [Releases](https://github.com/NurApps/NurChat/releases)
2. Запустите установщик
3. Укажите адрес релея (свой или публичный) — приложение подключится к нему

**Системные требования:**
- Windows 10+ (WebView2 встроен)
- 200 МБ свободного места

### Docker (сервер / production)

```bash
git clone https://github.com/NurApps/NurChat.git
cd NurChat
cp .env.example .env
# Отредактируйте .env (POSTGRES_PASSWORD, REDIS_PASSWORD, ключи)
docker-compose up -d
# Сервер на http://localhost:8000
```

Для публичного инстанса с HTTPS:

```bash
# DOMAIN=relay.example.com в .env, затем:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Режим глухого релея (стирать содержимое после доставки):

```bash
# в .env:
RELAY_DEAF=true
MESSAGE_RETENTION_HOURS=48
```

### Разработка

```bash
git clone https://github.com/NurApps/NurChat.git
cd NurChat

# Python
python -m venv .venv
.venv\Scripts\activate  # Windows; macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Миграции
.venv\Scripts\python -m alembic upgrade head

# Запуск релея (терминал 1)
.venv\Scripts\python -m uvicorn server.main:app --port 8000 --reload

# Запуск Tauri (терминал 2)
npx tauri dev
```

**Требования для разработки:** Python 3.12, Node.js 22+, Rust, WebView2

Без запущенного релея фронтенд покажет «Сервер недоступен» — `npx tauri dev`
релей не стартует, укажите `VITE_API_HOST` для удалённого.

---

## Архитектура

```
Tauri (Rust) ── wraps ──> React frontend ── HTTP/WS ──> FastAPI relay ──> SQLite/PostgreSQL
```

Релей — слепой курьер: передаёт зашифрованные сообщения, но не может их
прочитать (ключи существуют только на устройствах собеседников).

- **Десктоп:** SQLite (встроенный, без настройки)
- **Docker/Production:** PostgreSQL + Redis (через docker-compose)
- **База:** SQLAlchemy ORM, миграции через Alembic (`alembic upgrade head`)
- **Real-time:** WebSocket — `/ws/chat`, `/ws/calls`, `/ws/signaling`, `/ws/notifications`
- **Звонки:** WebRTC, сигналинг через WebSocket, NAT — STUN/TURN (coturn в compose)
- **Файлы:** локальное хранилище в `media/`, TTL-очистка по расписанию

---

## Лицензия

[GNU AGPL v3](LICENSE) © NurApps 2026
