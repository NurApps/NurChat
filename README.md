<p align="center">
  <img src="frontend/public/icon.png" width="120" alt="NurChat Logo">
</p>

<h1 align="center">NurChat</h1>

<p align="center">
  Self-hosted анонимный мессенджер<br>
  E2EE • Федерация • P2P • Нативное десктоп приложение
</p>

<p align="center">
  <a href="#features">Фичи</a> •
  <a href="#installation">Установка</a> •
  <a href="#development">Разработка</a> •
  <a href="#federation">Федерация</a> •
  <a href="#docker">Docker</a> •
  <a href="#license">Лицензия</a>
</p>

---

## Features

### 🔐 Безопасность

- **E2E шифрование** — Double Ratchet (Signal Protocol)
- **Ed25519 подписи** — верификация сообщений и P2P событий
- **CSRF защита** — HMAC токены для всех POST запросов
- **TOTP 2FA** — двухфакторная аутентификация с резервными кодами
- **CAPTCHA** — защита от ботов при регистрации
- **Вращение ключей** — авто-ротация с уведомлением контактов
- **Групповое E2E** — зашифрованный group key для групп

### 🌐 Федерация

- **Сервер-к-серверу** — Ed25519 подписанные activity
- **Адресация** — `user@host:port`
- **Авто-обнаружение** — `/.well-known/nurchat.json`
- **Самостоятельный хостинг** — один запуск = сервер + мессенджер

### 🕵️ Приватность

- **Без телефона** — регистрация без номера/email
- **Локальное хранение** — данные только на вашем сервере
- **Эфемерные сообщения** — авто-удаление по таймеру
- **PIN-код** — блокировка приложения

### 🔗 P2P

- **WebRTC DataChannel** — прямая передача файлов между пользователями
- **WebSocket** — real-time доставка сообщений, typing indicators, online/offline

### 📺 Медиа

- **Голосовые сообщения** — запись и воспроизведение
- **Видео-кружки** — короткие видео как в Telegram
- **Файлы** — загрузка до 50 МБ с прогрессом
- **Стикеры** — базовый набор + кастомные
- **Превью ссылок** — превью страниц в сообщениях

### 👥 Группы

- **Создание групп** — выбор участников, имя группы
- **Админы** — управление участниками
- **Приглашения** — инвайт-ссылки
- **Мут/пин** — отключение уведомлений, закрепление чатов

### 📞 Звонки

- **Аудио/видео** — WebRTC с TURN/STUN поддержкой
- **Видеозвонки** — переключение камер, демонстрация экрана
- **ICE restart** — авто-восстановление при обрыве
- **История звонков** — лог всех звонков

### 💾 Бэкапы

- **Зашифрованные бэкапы** — экспорт чатов и ключей
- **Восстановление** — импорт данных на другом устройстве

### ✨ Удобство

- **Тёмная/светлая тема** — авто-определение
- **Поиск** — глобальный поиск по сообщениям
- **Закладки** — сохранение важных сообщений
- **Пересылка** — пересылка сообщений в другие чаты
- **Редактирование** — inline редактирование сообщений
- **Реакции** — emoji реакции на сообщения

---

## Installation

### Десктоп (Windows)

1. Скачайте `NurChat_*_x64-setup.exe` с [Releases](https://github.com/NurApps/NurChat_desktop/releases)
2. Запустите установщик
3. Приложение автоматически запустит сервер (SQLite, zero-config)

**Системные требования:**
- Windows 10+ (WebView2 встроен)
- 200 МБ свободного места

### Docker (сервер / production)

```bash
git clone https://github.com/NurApps/NurChat_desktop.git
cd NurChat_desktop
cp .env.example .env
# Отредактируйте .env (DATABASE_URL, REDIS_URL, ключи)
docker-compose up -d
# Сервер на http://localhost:8000
```

### Разработка (macOS / Linux)

```bash
git clone https://github.com/NurApps/NurChat_desktop.git
cd NurChat_desktop

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
Tauri (Rust) ── wraps ──> React frontend ── HTTP/WS ──> FastAPI сервер ──> SQLite/PostgreSQL
                              │                              │
                              └── IPC commands ──────────────┘
```

- **Десктоп:** SQLite (встроенный, без настройки)
- **Docker/Production:** PostgreSQL + Redis (через docker-compose)
- **База:** SQLAlchemy ORM, миграции через Alembic
- **Real-time:** WebSocket (ws://) для сообщений и статусов
- **Файлы:** локальное хранилище в `media/` (не облако)
- **P2P:** опционально, через WebRTC + UDP multicast
- **E2EE:** Double Ratchet (Signal Protocol), X3DH для начального обмена ключами

---

## Docker

### Сервисы

| Сервис | Порт | Описание |
|--------|------|----------|
| `nurchat` | 8000 | FastAPI сервер |
| `db` | 5432 | PostgreSQL 15 |
| `redis` | 6379 | Redis (presence, кэш) |

### Переменные окружения

```ini
# База данных
DATABASE_URL=postgresql://nurchat:nurchat_pass@db:5432/nurchat

# Redis
REDIS_URL=redis://redis:6379/0
USE_REDIS=true

# Ключи шифрования (обязательно сменить!)
ENCRYPTION_KEY=<32 байта hex>
JWT_SECRET_KEY=<32 байта hex>
```

### Health Check

```bash
curl http://localhost:8000/health
# {"status": "healthy"}
```

---

## Federation

NurChat поддерживает федерацию — серверы общаются друг с другом.

### Включение

```bash
# .env
USE_FEDERATION=true
FEDERATION_SERVER_NAME=your-server.com:8000
```

### Как работает

1. **Discovery** — `GET /.well-known/nurchat.json` (публичный ключ сервера)
2. **User lookup** — `GET /federation/user/{username}`
3. **Message relay** — `POST /federation/inbox` (подписанное activity)
4. **Адресация** — `user@host:port`

### Протокол

- Каждый сервер генерирует Ed25519 ключ при старте
- Activity подписываются серверным ключом
- Получатель верифицирует подпись через `/.well-known/nurchat.json`
- E2E шифрование сохраняется — сервер видит только зашифрованный контент

---

## Development

### Структура проекта

```
NurChat_desktop/
├── frontend/           # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/ # UI компоненты
│   │   ├── pages/      # Страницы (Chat, Call, Settings...)
│   │   ├── services/   # API клиент, E2E, P2P
│   │   └── hooks/      # React hooks
│   └── public/
├── server/             # FastAPI + SQLAlchemy
│   ├── core/           # Models, security, federation
│   ├── routes/         # API endpoints
│   ├── ws/             # WebSocket managers
│   └── utils/          # Helpers
├── shared/             # Общие конфиги, схемы, константы
├── src-tauri/          # Rust Tauri backend
│   └── src/
│       ├── lib.rs      # Tauri commands
│       ├── server.rs   # Auto-start Python server
│       └── p2p.rs      # P2P networking
└── alembic/            # DB миграции
```

### Команды

```bash
# Сервер
python -m uvicorn server.main:app --port 8000 --reload

# Tauri dev
npx tauri dev

# Tauri build (installer)
npx tauri build

# Тесты
pytest test/ -v

# Линтер
ruff check .

# TypeScript
cd frontend && npx tsc --noEmit
```

---

## 🔐 TOTP 2FA

NurChat поддерживает TOTP (Time-based One-Time Password) для дополнительной защиты.

### Настройка

1. Войдите в аккаунт → Настройки → Безопасность
2. Нажмите "Включить 2FA"
3. Отсканируйте QR-код в Google Authenticator / Authy / аналоге
4. Введите 6-значный код
5. Сохраните резервные коды

### Вход

После включения 2FA при входе потребуется логин + пароль + TOTP код (или резервный код).

---

## 💾 Бэкапы

1. Настройки → Бэкапы → Создать бэкап
2. Введите пароль шифрования (AES-256-GCM)
3. Скачайте `.nurchat-backup`

Восстановление — через страницу `/backup`.

---

## License

[GNU AGPL v3](LICENSE) — NurApps 2026

---
