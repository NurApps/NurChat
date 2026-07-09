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

### Шифрование
- **E2E шифрование** — X25519 + NaCl sealed box (как Signal)
- **Ed25519 подписи** — верификация сообщений и P2P событий
- **Вращение ключей** — авто-ротация с уведомлением контактов
- **Групповое E2E** — зашифрованный group key для групп

### Федерация
- **Сервер-к-серверу** — Ed25519 подписанные activity (как Matrix)
- **Адресация** — `user@host:port` (как email)
- **Авто-обнаружение** — `/.well-known/nurchat.json`
- **Самостоятельный хостинг** — один запуск = сервер + мессенджер

### Приватность
- **Без телефона** — регистрация без номера/email (как Session)
- **Локальное хранение** — всё на вашем сервере (как Briar)
- **Эфемерные сообщения** — авто-удаление по таймеру
- **PIN-код** — блокировка приложения

### P2P
- **WebRTC DataChannel** — прямая передача файлов между пользователями
- **IPFS** — контент-адресация, кеширование, доступность без центрального сервера
- **WebSocket** — real-time доставка сообщений, typing indicators, online/offline

### Медиа
- **Голосовые сообщения** — запись и воспроизведение
- **Видео-кружки** — короткие видео как в Telegram
- **Файлы** — загрузка до 50 МБ с прогрессом
- **Стикеры** — базовый набор + кастомные
- **Превью ссылок** — превью страниц в сообщениях

### Группы
- **Создание групп** — выбор участников, имя группы
- **Админы** — управление участниками
- **Приглашения** — инвайт-ссылки
- **Мут/пин** — отключение уведомлений, закрепление чатов

### Звонки
- **Аудио/видео** — WebRTC с TURN/STUN поддержкой
- **ICE restart** — авто-восстановление при обрыве
- **История звонков** — лог всех звонков

### Удобство
- **Тёмная/светлая тема** — авто-определение
- **Поиск** — глобальный поиск по сообщениям
- **Закладки** — сохранение важных сообщений
- **Пересылка** — пересылка сообщений в другие чаты
- **Редактирование** — inline редактирование сообщений
- **Реакции** — emoji реакции на сообщения

---

## Installation

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
- **Node.js 22+** (для Tauri фронта)
- **Rust** (для сборки Tauri)
- **WebView2** (Windows, устанавливается автоматически)

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
├── frontend/           # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/ # UI компоненты
│   │   ├── pages/      # Страницы (Chat, Call, Settings...)
│   │   ├── services/   # API клиент, E2E, P2P
│   │   └── hooks/      # React hooks
│   └── public/
├── server/             # FastAPI + SQLAlchemy
│   ├── core/           # Models, security, federation, IPFS
│   ├── routes/         # API endpoints
│   ├── ws/             # WebSocket managers
│   └── utils/          # Helpers
├── shared/             # Общие конфиги, схемы, константы
├── src-tauri/          # Rust Tauri backend
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

# Tauri dev
npx tauri dev

# Tauri build (installer)
npx tauri build

# Тесты
pytest test/ -v

# TypeScript check
cd frontend && npx tsc --noEmit
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

