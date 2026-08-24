<p align="center">
  <img src="frontend/public/icon.png" width="120" alt="NurChat Logo">
</p>

<h1 align="center">NurChat</h1>

<p align="center">
  Анонимный мессенджер со сквозным шифрованием.<br>
  Без телефона, без email, без имени.
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

- **Сквозное шифрование (E2E)** — Double Ratchet (Signal Protocol): X3DH,
  Signed Pre-Keys, One-Time Pre-Keys, forward secrecy на каждом сообщении
- **Анонимность** — вход по криптографическому ключу: ни телефона, ни почты
- **Группы, реакции, ответы, пересылка, закрепления** — привычный набор
- **Опросы, view-once медиа, голосовые, файлы**
- **Аудио/видеозвонки и групповые звонки** (WebRTC)
- **2FA (TOTP)** с backup-кодами
- **P2P-режим** — прямые зашифрованные соединения между устройствами
  (`nurchat://` ссылки), WebRTC fallback

## Безопасность

Что реализовано:

| Компонент | Реализация |
|---|---|
| Протокол | X3DH + Double Ratchet (как в Signal) |
| Шифры | XChaCha20-Poly1305 / AES-256-GCM, Ed25519 подписи |
| Post-compromise security | DH-ratchet самовосстанавливает сессию после компрометации ключа |
| Replay protection | Отслеживание message ID per session |
| P2P транспорт | X25519 ECDH + ChaCha20-Poly1305, ключи привязаны к идентичности |
| Аутентификация сервера | Argon2id, JWT c отзывом, TOTP 2FA |

Чего у нас **нет** — говорим честно:

- **Внешнего аудита.** Код не проверялся независимыми аудиторами. Реализация
  протокола своя: схема проверена годами в Signal, но в нашей реализации
  возможны ошибки.
- **Формальной верификации** протокола (Tamarin/ProVerif).
- **Защиты метаданных.** Релей видит, кто с кем и когда общается. В режиме
  `RELAY_DEAF` содержимое стирается после доставки, но граф общения остаётся.
- **Аппаратной защиты ключей** — приватные ключи хранятся на устройстве
  под шифрованием, но не в secure enclave.

Если найдёте уязвимость — [сообщите](https://github.com/NurApps/NurChat/security/advisories/new),
мы исправимся быстро.

> Мы не используем слова «военная криптография». Скептицизм полезнее доверия:
> читайте код, тестируйте, сообщайте о проблемах.

## Установка

### Десктоп (Windows)

1. Скачайте `NurChat_*_x64-setup.exe` с [Releases](https://github.com/NurApps/NurChat/releases)
2. Запустите установщик
3. Приложение автоматически запустит сервер (SQLite, zero-config)

**Системные требования:**
- Windows 10+ (WebView2 встроен)
- 200 МБ свободного места

### Docker (сервер / production)

```bash
git clone https://github.com/NurApps/NurChat.git
cd NurChat
cp .env.example .env
# Отредактируйте .env (DATABASE_URL, REDIS_URL, ключи)
docker-compose up -d
# Сервер на http://localhost:8000
```

Для публичного инстанса с HTTPS:

```bash
cp infra/Caddyfile infra/Caddyfile  # укажите свой домен
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Режим глухого релея (хранить содержимое только до доставки):

```bash
# в .env:
RELAY_DEAF=true
MESSAGE_RETENTION_HOURS=48
```

### Разработка (macOS / Linux)

```bash
git clone https://github.com/NurApps/NurChat.git
cd NurChat

# Python
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd frontend && npm install && cd ..

# Запуск
python -m uvicorn server.main:app --port 8000 &
npx tauri dev
```

**Требования для разработки:** Python 3.10+, Node.js 22+, Rust, WebView2

---

## Архитектура

```
Tauri (Rust) ── wraps ──> React frontend ── HTTP/WS ──> FastAPI relay ──> SQLite/PostgreSQL
                              │                              │
                              └── IPC commands ──────────────┘
                              │
                              └── P2P TCP/WebRTC (напрямую между устройствами)
```

Релей — слепой курьер: передаёт зашифрованные сообщения, но не может их
прочитать (ключи существуют только на устройствах собеседников).

- **Десктоп:** SQLite (встроенный, без настройки)
- **Docker/Production:** PostgreSQL + Redis (через docker-compose)
- **База:** SQLAlchemy ORM, миграции через Alembic
- **Real-time:** WebSocket для доставки и статусов
- **Файлы:** локальное хранилище в `media/`

---

## Лицензия

[GNU AGPL v3](LICENSE) © NurApps 2026
