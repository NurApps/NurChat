<p align="center">
  <img src="frontend/public/icon.png" width="120" alt="NurChat Logo">
</p>

<h1 align="center">NurChat</h1>

<p align="center">
  Анонимный мессенджер нового поколения с гибридным протоколом<br>
  <b>Signal + Matrix + Session + Briar + IPFS = NurChat</b>
</p>

<p align="center">
  <a href="#features">Фичи</a> •
  <a href="#installation">Установка</a> •
  <a href="#development">Разработка</a> •
  <a href="#federation">Федерация</a> •
  <a href="#protocol">Протокол</a> •
  <a href="#license">Лицензия</a>
</p>

---

## Features

### 🔐 Безопасность

- **E2E шифрование** — X25519 + NaCl sealed box (как Signal)
- **Ed25519 подписи** — верификация сообщений и P2P событий
- **CSRF защита** — HMAC токены для всех POST запросов
- **TOTP 2FA** — двухфакторная аутентификация с резервными кодами
- **CAPTCHA** — защита от ботов при регистрации
- **Вращение ключей** — авто-ротация с уведомлением контактов
- **Групповое E2E** — зашифрованный group key для групп

### 🌐 Федерация

- **Сервер-к-серверу** — Ed25519 подписанные activity (как Matrix)
- **Адресация** — `user@host:port` (как email)
- **Авто-обнаружение** — `/.well-known/nurchat.json`
- **Самостоятельный хостинг** — один запуск = сервер + мессенджер

### 🕵️ Приватность

- **Без телефона** — регистрация без номера/email (как Session)
- **Локальное хранение** — всё на вашем сервере (как Briar)
- **Эфемерные сообщения** — авто-удаление по таймеру
- **PIN-код** — блокировка приложения

### 🔗 P2P

- **WebRTC DataChannel** — прямая передача файлов между пользователями
- **IPFS** — контент-адресация, кеширование, доступность без центрального сервера
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

- **Зашифрованные бэкапы** — экспорт чатов и ключей в зашифрованном виде
- **Восстановление** — импорт данных на другом устройстве

### ✨ Удобство

- **Тёмная/светлая тема** — авто-определение
- **Поиск** — глобальный поиск по сообщениям
- **Закладки** — сохранение важных сообщений
- **Пересылка** — пересылка сообщений в другие чаты
- **Редактирование** — inline редактирование сообщений
- **Реакции** — emoji реакции на сообщения

---

## Установка

### Docker (рекомендуется)

```bash
# 1. Клонируем репозиторий
git clone https://github.com/NurApps/NurChat_desktop_beta.git
cd NurChat_desktop

# 2. Настраиваем переменные окружения
cp .env.example .env
# Отредактируйте .env и установите:
# - ENCRYPTION_KEY (32 байта в hex, например: openssl rand -hex 32)
# - JWT_SECRET_KEY (для сессий)

# 3. Запускаем через Docker Compose
docker-compose up -d

# 4. Проверяем статус
docker-compose ps

# Сервер доступен на http://localhost:8000
# PostgreSQL на localhost:5432
# Redis на localhost:6379

# Для локальной разработки (без Docker):
# - SQLite используется по умолчанию (файл nurchat.db)
# - Redis опционален (USE_REDIS=false по умолчанию)
```

### Windows

1. Скачайте `NurChat_*_x64-setup.exe` с [Releases](https://github.com/NurApps/NurChat_desktop_beta/releases)
2. Запустите установщик
3. Приложение автоматически запустит Python сервер

### macOS / Linux

```bash
git clone https://github.com/NurApps/NurChat_desktop_beta.git
cd NurChat_desktop
./start.sh
```

### Требования

- **Python 3.10+** (для сервера)
- **Node.js 22+** (для фронтенда)
- **Rust** (для сборки Tauri)
- **WebView2** (Windows, устанавливается автоматически)
- **Docker & Docker Compose** (для контейнеризации, опционально)

### Стек технологий

**Frontend:**
- React 19 + TypeScript 6 + Vite 8
- Zustand — стейт-менеджмент
- React Router 7 — навигация
- i18next — интернационализация
- TweetNaCl — клиентское E2E шифрование
- React Window — виртуализация списков
- DOMPurify — санитайзинг HTML
- Vitest — тесты

**Backend:**
- FastAPI 0.135 + Uvicorn
- SQLAlchemy 2.0 + Alembic (миграции)
- SQLite (дефолт для локалки) / PostgreSQL 15 (Docker)
- PyNaCl + cryptography — E2E шифрование
- python-jose — JWT токены
- Argon2 — хеширование паролей
- PyOTP — TOTP 2FA
- SlowAPI — rate limiting
- Redis (опционально) — кэш, rate-limiting

**Desktop (Tauri 2.11):**
- Tauri + Rust — нативная оболочка
- Плагины: notification, shell, log
- Reqwest — HTTP-запросы из Rust
- Tokio — async runtime

---

## Development

### Быстрый старт

```bash
# 1. Клонируем
git clone https://github.com/NurApps/NurChat_desktop_beta.git
cd NurChat_desktop

# 2. Python venv
python -m venv .venv
.venv\Scripts\activate  # Windows
pip install -r requirements.txt

# 3. Frontend
cd frontend && npm install && cd ..

# 4. Запуск (сервер + Tauri)
./start.bat  # Windows
# или
python -m uvicorn server.main:app --port 8000 &  # сервер отдельно
npx tauri dev  # Tauri отдельно
```

### Структура проекта

```
NurChat_desktop/
├── frontend/           # React 19 + TypeScript 6 + Vite 8
│   ├── src/
│   │   ├── components/ # UI компоненты
│   │   ├── pages/      # Страницы (Chat, Call, Settings...)
│   │   ├── services/   # API клиент, E2E, P2P
│   │   └── hooks/      # React hooks
│   └── public/
├── server/             # FastAPI 0.135 + SQLAlchemy 2.0
│   ├── core/           # Models, security, federation, IPFS
│   ├── routes/         # API endpoints
│   ├── ws/             # WebSocket managers
│   └── utils/          # Helpers
├── shared/             # Общие конфиги, схемы, константы
├── src-tauri/          # Tauri 2.11 (Rust shell)
│   └── src/
│       ├── lib.rs      # Tauri commands
│       ├── server.rs   # Auto-start Python server
│       ├── ipfs.rs     # IPFS client
│       └── p2p.rs      # P2P networking
└── alembic/            # DB миграции
```

### Команды

```bash
# Сервер
python -m uvicorn server.main:app --port 8000 --reload

# Фронтенд (отдельно, если нужно без Tauri)
cd frontend && npm run dev  # порт 5173

# Tauri dev (запуск десктопного приложения в dev-режиме)
npx tauri dev

# Tauri build (installer)
npx tauri build

# Тесты
pytest test/ -v

# Фронтенд тесты
cd frontend && npx vitest run

# Фронтенд линтер
cd frontend && npm run lint

# TypeScript check
cd frontend && npx tsc --noEmit
```

---

## 🔐 Двухфакторная аутентификация (TOTP 2FA)

NurChat поддерживает TOTP (Time-based One-Time Password) для дополнительной защиты аккаунта.

### Настройка 2FA

1. **Войдите в аккаунт** с логином и паролем
2. **Откройте Настройки** → раздел "Безопасность"
3. **Нажмите "Включить 2FA"**
4. **Отсканируйте QR-код** в приложении аутентификации:
   - Google Authenticator
   - Authy
   - Microsoft Authenticator
   - Любой другой TOTP-совместимый апп
5. **Введите 6-значный код** из приложения
6. **Сохраните резервные коды** в безопасном месте!

```
⚠️ Важно: Резервные коды можно использовать только один раз каждый.
Если вы потеряете доступ к TOTP и резервным кодам, восстановление невозможно!
```

### Вход с 2FA

После включения 2FA при входе потребуется:
1. Ввести логин и пароль
2. Ввести 6-значный код из приложения аутентификации
   **ИЛИ**
3. Ввести одноразовый резервный код

### Отключение 2FA

1. Войдите в аккаунт (с TOTP кодом)
2. Откройте Настройки → Безопасность
3. Нажмите "Отключить 2FA"
4. Подтвердите текущим TOTP кодом

### Потеряли доступ?

Если вы потеряли телефон с TOTP приложением:
- Используйте **резервные коды**, которые вы сохранили при настройке
- Каждый код можно использовать **только один раз**
- После использования код становится недействительным

---

## 💾 Бэкапы и восстановление

### Создание бэкапа

1. Откройте Настройки → "Бэкапы"
2. Нажмите "Создать бэкап"
3. Введите пароль для шифрования бэкапа
4. Скачайте зашифрованный файл `.nurchat-backup`

**Что включается в бэкап:**
- Все чаты и сообщения
- Контакты
- Ключи шифрования E2E
- Настройки аккаунта

### Восстановление из бэкапа

1. На новом устройстве откройте страницу "/backup"
2. Выберите "Восстановить из бэкапа"
3. Загрузите файл `.nurchat-backup`
4. Введите пароль шифрования
5. Дождитесь завершения импорта

```
⚠️ Важно: Бэкапы зашифрованы алгоритмом AES-256-GCM.
Без пароля восстановить данные невозможно!
```

---

## 🐳 Docker Compose

### Быстрый старт

```bash
# Запуск всех сервисов
docker-compose up -d

# Просмотр логов
docker-compose logs -f nurchat

# Остановка
docker-compose down

# Полная очистка (удалит все данные!)
docker-compose down -v
```

### Сервисы

| Сервис | Порт | Описание |
|--------|------|----------|
| `nurchat` | 8000 | FastAPI сервер NurChat |
| `db` | 5432 | PostgreSQL 15 (база данных) |
| `redis` | 6379 | Redis 7 (кэш, rate-limiting, WebSocket pub/sub) |

### Переменные окружения

Скопируйте `.env.example` в `.env` и настройте:

```ini
# База данных
# Дефолт для локальной разработки: sqlite:///./nurchat.db
# Docker: postgresql://nurchat:nurchat_pass@db:5432/nurchat
DATABASE_URL=sqlite:///./nurchat.db

# Redis (опционально, для кэша и rate-limiting)
USE_REDIS=false
REDIS_URL=redis://localhost:6379/0

# Секретные ключи
ENCRYPTION_KEY=ваш_ключ_шифрования_32_байта_hex
JWT_SECRET_KEY=ваш_ключ_для_сессий_hex

# Федерация (опционально)
USE_FEDERATION=false
FEDERATION_SERVER_NAME=localhost:8000

# CORS
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173
```

### Генерация ключей

```bash
# ENCRYPTION_KEY (32 байта)
openssl rand -hex 32

# JWT_SECRET_KEY (32 байта)
openssl rand -hex 32
```

### Миграции БД

При первом запуске миграции применяются автоматически. Для ручного применения:

```bash
docker-compose exec nurchat alembic upgrade head
```

### Health Check

Сервер имеет health check эндпоинт:

```bash
curl http://localhost:8000/health
# Ответ: {"status": "healthy"}
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
4. **Адресация** — `user@host:port` (как email)

### Протокол

- Каждый сервер генерирует Ed25519 ключ при старте
- Activity подписываются серверным ключом
- Получатель верифицирует подпись через `/.well-known/nurchat.json`
- E2E шифрование сохраняется — сервер видит только зашифрованный контент

---

## Protocol

### Гибридный протокол NurChat

Мы взяли лучшее из каждого протокола и смешали:

| Протокол | Что взяли | Зачем |
|----------|-----------|-------|
| **Signal** | X25519 + NaCl sealed box | Доказанное E2E шифрование |
| **Matrix** | Federation (inbox/outbox) | Серверы общаются без единой точки отказа |
| **Session** | Анонимность без телефона | Приватность регистрации |
| **Briar** | Локальное хранение, P2P | Автономность от облаков |
| **IPFS** | Content-addressed файлы | Доступность через CID, кеширование |
| **Telegram** | UX (группы, файлы, стикеры) | Привычный интерфейс |

### Сравнение

| | Signal | Matrix | Session | Briar | **NurChat** |
|---|---|---|---|---|---|
| E2E шифрование | ✅ | ✅ | ✅ | ✅ | ✅ |
| Федерация | ❌ | ✅ | ❌ | ❌ | ✅ |
| Без телефона | ❌ | ✅ | ✅ | ✅ | ✅ |
| P2P | ❌ | ⚠️ | ✅ | ✅ | ✅ |
| IPFS | ❌ | ❌ | ❌ | ❌ | ✅ |
| Самостоятельный хостинг | ❌ | ✅ | ✅ | ✅ | ✅ |
| Нативное десктоп приложение | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## License

[GNU AGPL v3](LICENSE) — NurApps 2026

---

