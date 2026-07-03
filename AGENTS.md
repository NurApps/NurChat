# AGENTS.md

## Session Summary

### Goal
Перенести NurChat с Flet на Tauri (React + Rust) для нативного десктопа; Python CORE — sidecar.

### Constraints & Preferences
- Анонимность без номера телефона / email
- Исламская направленность + self-hosted (без Supabase/Firebase, чисто локально)
- Лицензия GNU AGPL v3
- Tauri → React + Vite (фронт), Rust (бэк), Python — только P2P/крипто

### Done
- **Supabase/Firebase/Firestore полностью удалены** — удалены `server/core/firestore_repositories.py`, `server/core/db_adapter.py`, `shared/firestore_config.py`, `docs/MIGRATION_GUIDE.md`. Из роутов (`auth.py`, `chat.py`, `contacts_groups.py`, `files.py`) убраны все `USE_FIRESTORE` ветки. Из `shared/config.py` и `.env` удалены `USE_FIRESTORE`, `FIREBASE_PROJECT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_BUCKET_NAME`, `USE_SUPABASE_STORAGE`. Из `requirements.txt` удалён `google-cloud-firestore`
- **start.bat** — скрипт быстрого запуска сервера и Tauri (через `.venv\Scripts\python`)
- **Файлы/голосовые больше не 401** — `/api/files/download/{file_id}` принимает `?token=...` query параметр (помимо Authorization header). Фронт: `api.getFileUrl()` добавляет токен в URL
- **ProfilePage** (`/profile`) — просмотр профиля: имя, фамилия, статус, био, аватар, дата регистрации. Кнопка «Редактировать профиль» → `/settings`
- **Аватар** — загрузка и удаление через `/api/auth/profile/avatar` в `ProfilePage` и `SettingsPage`
- **Смена аккаунта** — дропдаун TopBar: «Профиль» → `/profile`, «Сменить аккаунт» → очистка токена → `/login`
- **Реакции (серверные)** — модель `MessageReaction` в БД, `POST /api/chat/messages/{message_id}/react` (toggle), `GET .../reactions`. Фронт сохраняет/загружает реакции с сервера, optimistic update с откатом
- **Поиск сообщений** — `GET /api/chat/chats/{chat_id}/search?q=...`, UI в ChatPage (поле поиска + результаты inline)
- **Пересылка сообщений** — `ForwardModal.tsx` (выбор чатов из списка доступных), `api.forwardMessage()` → `POST /api/forward/forward`
- **Редактирование сообщений** — inline edit в `MessageBubble` (textarea вместо контента, save/cancel), `api.editMessage()` + WebSocket `edit_message`
- **Удаление сообщений** — диалог «удалить у себя / удалить у всех» (`delete_for_all`), поддержка `deleted_for_all` колонки в модели
- **Typing indicator** — WebSocket event `typing` отправляется/принимается, UI отображает «печатает...» в хедере чата (авто-сброс через 4 секунды)
- **Online/offline reactive** — WebSocket события `user_online`/`user_offline` обновляют статус в реальном времени
- **WebSocket клиент** — `ChatPage` подключается к `/ws/chat/{user_id}?token=...` с auto-reconnect (3 сек). Обрабатывает: typing, user_online/offline, message, message_delivered, delete_message, edit_message
- **NotificationToast** — всплывающий тост при новом сообщении из другого чата (имя + превью), клик переключает на чат
- **CSS** — `.settings-avatar-img`, `.avatar-actions`, `.avatar-btn`, `.profile-field*`, forward-modal, reaction-bar, msg-edit-mode, msg-delete-options, search-bar, toast-notification, typing-индикатор
- **MessageBubble** — переписана: edit mode, delete options, forward indicator, реакции с сервера, меню для чужих сообщений (копировать/переслать)
- **`api.deleteMessage()`** теперь принимает `deleteForAll` параметр (false по умолчанию)
- **WS endpoint** `/ws/chat/{user_id}` теперь принимает `token` query параметр (верифицирует JWT)

### In Progress
- `/api/legal/privacy/text` response_model: dict, 200
- `/api/legal/agreement/text` response_model: dict, 200

### Blocked
- **CallPage** — UI-only, WebRTC не реализован (нужен signaling, ICE, peer connection)
- **P2P / IPFS** — включены в конфиге (`USE_P2P=True`, `USE_IPFS=True`), клиентская часть не подключена
- **Emoji picker** — базовый компонент есть, нужен полноценный пакет эмодзи

### Key Decisions
- **Локальное хранение** — все файлы в `media/` через `FileStorage`, никаких внешних облачных сервисов
- **Токен в query параметре для медиа** — чтобы `<img>`, `<audio>`, `<video>` могли загружать защищённые файлы (без JS-заголовков)
- **Реакции хранятся в БД** — модель `MessageReaction` с полями `message_id`, `user_id`, `emoji`. Фронт делает optimistic update с откатом при ошибке
- **WebSocket как единый канал** — через один WS коннект идут typing, online, сообщения, уведомления (без отдельного `/ws/notifications`)
- **`delete_for_all`** — колонка в `Message`, фронт показывает «Сообщение удалено» вместо полного скрытия

### Next Steps
1. Установить полноценный emoji-picker (emoji-mart или аналог)
2. Реализовать WebRTC для звонков (signaling через `/ws/calls/{user_id}`)
3. Подключить P2P/IPFS роутинг
4. Анимировать переходы, улучшить UX

### Critical Context
- **Node** 22.14.0 на `D:\node-v22.14.0-win-x64`, npm работает из cmd
- **Tauri** v2, **Vite** 8, **React** 19, **TypeScript** 6
- **Сервер** FastAPI на SQLite + SQLAlchemy (локально), файлы в `media/`
- **Сборка**: `npm run build` проходит чисто (`tsc -b && vite build`)
- **Запуск сервера**: `.venv\Scripts\python -m uvicorn server.main:app --host 0.0.0.0 --port 8000 --reload`
- **Запуск Tauri**: `npx tauri dev` (запускает Vite + Tauri, сервер нужен отдельно)
- **start.bat** — запускает сервер в отдельном окне, затем Tauri
- Внешние сервисы не требуются — всё локально

## Relevant Files
- `frontend/src/pages/ChatPage.tsx`: главная страница (сайдбар + чат + WS + typing + online + поиск + forward + уведомления + @mentions + модалки)
- `frontend/src/pages/ProfilePage.tsx`: просмотр профиля + смена/удаление аватара
- `frontend/src/pages/SettingsPage.tsx`: редактирование профиля + смена/удаление аватара
- `frontend/src/pages/LoginPage.tsx`: вход/регистрация, сохранение токена и user в localStorage
- `frontend/src/pages/LegalPage.tsx`: политика конфиденциальности и пользовательское соглашение
- `frontend/src/pages/CallPage.tsx`: UI звонка (аудио/видео) без WebRTC
- `frontend/src/components/MessageBubble.tsx`: сообщение + файлы + реакции + edit mode + delete options + forward
- `frontend/src/components/ForwardModal.tsx`: модалка выбора чатов для пересылки
- `frontend/src/components/NotificationToast.tsx`: всплывающий тост для новых сообщений
- `frontend/src/components/TopBar.tsx`: дропдаун (Профиль, Сменить аккаунт, Выйти) + кнопки (настройки, правила, тема, выход)
- `frontend/src/components/AddContactModal.tsx`: поиск/добавление контакта
- `frontend/src/components/CreateChatModal.tsx`: создание чата (выбор участников, имя группы)
- `frontend/src/components/ChatListItem.tsx`: пункт чата с меню (закрепить, muted, удалить)
- `frontend/src/components/EmojiPicker.tsx`: базовый выбор эмодзи
- `frontend/src/services/api.ts`: HTTP-клиент (все эндпоинты, включая search, reactions, forward, uploadFile, getFileUrl, deleteMessage с deleteForAll)
- `frontend/src/types.ts`: типы (MessageResponse, ReactionResponse, и т.д.)
- `frontend/src/index.css`: все стили (чат, модалки, forward, реакции, edit, delete, search, toast, typing, аватар)
- `frontend/src/App.tsx`: роуты: `/login`, `/chat`, `/call/:userId/:type`, `/settings`, `/profile`, `/legal`
- `server/main.py`: WS endpoint с опциональным token query param
- `server/routes/auth.py`: `/register`, `/login`, `/me`, `/users`, `/profile/update`, `/profile/avatar`
- `server/routes/chat.py`: CRUD чатов/сообщений, search, reactions (toggle/get), delete chat, block, export
- `server/routes/contacts_groups.py`: контакты, группы, приглашения
- `server/routes/files.py`: загрузка/скачивание/удаление файлов (только локальное хранение, token query param)
- `server/routes/forward.py`: пересылка сообщений
- `server/routes/legal.py`: политика и соглашение (markdown)
- `server/core/models.py`: модели SQLAlchemy (включая MessageReaction, `deleted_for_all` в Message)
- `server/core/storage.py`: локальное файловое хранилище (`media/`)
- `server/core/security.py`: генерация ключей, JWT, хеши паролей
- `server/ws/chat_manager.py`: WebSocket менеджер (typing, online, сообщения, delete/edit)
- `shared/config.py`: настройки (без Supabase/Firebase)
- `shared/schemas.py`: Pydantic схемы (включая ReactionCreate, ReactionResponse)
- `start.bat`: быстрый запуск сервера + Tauri
