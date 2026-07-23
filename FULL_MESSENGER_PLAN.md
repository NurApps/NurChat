# План доведения NurChat до полноценного P2P/Federated мессенджера

## Короткий ответ по текущему взаимодействию

Да, пользователи уже могут взаимодействовать между собой:

1. **Централизованный режим сейчас работает как база:**
   - зарегистрированные пользователи могут создавать чаты;
   - участники чата могут обмениваться текстовыми сообщениями;
   - сообщения идут через REST `POST /api/chat/chats/{chat_id}/messages` и WebSocket `/ws/chat/{user_id}`;
   - файлы/медиа/голосовые идут через `/api/files/upload` и `/api/files/download/{file_id}`.

2. **Звонки уже имеют WebRTC signalling:**
   - серверный signalling есть в `server/ws/signaling.py`;
   - клиентский signalling есть в `client/services/call_websocket_client.py`;
   - но звонки нужно довести до стабильного UI/UX: STUN/TURN, обработка состояний, устройства, история звонков.

3. **P2P-режим уже заложен:**
   - добавлен relay `/ws/p2p/{user_id}`;
   - добавлены локальные identity, Double Ratchet, SQLite local store;
   - сообщения могут идти через WebRTC DataChannel, а при недоступности channel — через зашифрованный relay;
   - P2P пока требует включения `USE_P2P=true` и дальнейшей интеграции discovery/UI.

---

## Целевая архитектура

### Транспорт

- **Realtime messaging:** WebRTC DataChannel.
- **Fallback/offline relay:** WebSocket P2P relay.
- **Discovery:** серверный registry + public keys пользователей.
- **NAT traversal:** STUN/TURN.
- **Calls:** WebRTC PeerConnection.

### Криптография

- **Identity:** Ed25519 signing key + X25519 encryption key.
- **1:1 messages:** Double Ratchet.
- **Group messages:**第一阶段 symmetric group session key, затем переход на MLS.
- **Files/voice/media:** client-side encryption before upload.
- **Backups:** encrypted backup with user-controlled recovery secret.

### Хранение

- **Local:** SQLite local store.
- **Server:** encrypted relay messages, identity public keys, discovery metadata.
- **Attachments:** encrypted blobs on server storage.
- **History sync:** append-only CRDT/event log.

---

## P0 — стабилизировать текущий мессенджер

### 1. Сообщения

Файлы:

- `client/pages/chat_page.py`
- `client/services/message_logic.py`
- `client/services/api_client.py`
- `server/ws/chat_manager.py`
- `server/routes/chat.py`

Задачи:

- убрать polling, если WebSocket подключён;
- гарантировать отправку через WebSocket с REST fallback;
- показывать статусы: `sending`, `sent`, `delivered`, `failed`;
- идемпотентная обработка входящих сообщений по `message_id`;
- корректная обработка редактирования/удаления через WebSocket;
- локальный pending queue при потере сети.

### 2. Медиа

Файлы:

- `client/services/media_manager.py`
- `client/services/api_client.py`
- `server/routes/files.py`
- `server/core/storage.py`

Задачи:

- загрузка с progress bar;
- предпросмотр изображений/video;
- thumbnails для изображений/video;
- retry failed uploads;
- encrypted upload/download;
- cleanup temp files;
- ограничение размера и типа файлов.

### 3. Голосовые сообщения

Файлы:

- `client/components/audio_recorder.py`
- `client/components/audio_recorder_v2.py`
- `client/services/voice_manager.py`
- `client/services/message_logic.py`

Задачи:

- запись → preview → отправка;
- waveform playback;
- длительность и размер;
- отмена записи;
- сжатие/нормализация WAV/OGG;
- encrypted upload;
- playback прямо из чата.

---

## P1 — полноценные звонки

Файлы:

- `server/ws/signaling.py`
- `server/routes/calls.py`
- `client/services/call_websocket_client.py`
- `client/pages/call_page.py`

Задачи:

1. **Audio/video call states:**
   - `idle`
   - `calling`
   - `ringing`
   - `connected`
   - `ended`
   - `missed`
   - `rejected`
   - `failed`

2. **WebRTC:**
   - STUN/TURN configuration;
   - ICE candidates;
   - media tracks;
   - mute/unmute;
   - camera on/off;
   - speaker selection;
   - network quality indicator.

3. **UX:**
   - incoming call screen;
   - accept/reject;
   - call timer;
   - end call confirmation;
   - call history.

4. **Server:**
   - relay signalling;
   - call logs;
   - missed call notifications;
   - optional TURN-only fallback.

Рекомендация: для 1:1 звонков оставить P2P WebRTC. Для групповых звонков позже добавить SFU: mediasoup/Janus/LiveKit.

---

## P2 — P2P messaging до production-ready

Файлы:

- `client/services/p2p_manager.py`
- `client/services/p2p_identity.py`
- `client/services/p2p_double_ratchet.py`
- `client/services/p2p_local_store.py`
- `client/services/p2p_signaling_client.py`
- `server/ws/p2p_manager.py`
- `server/routes/p2p.py`

Задачи:

1. **Discovery:**
   - поиск пользователя по username/id;
   - получение public keys;
   - сохранение peer identity;
   - online/offline status через relay.

2. **WebRTC DataChannel:**
   - создание channel при первом сообщении;
   - очередь сообщений до открытия channel;
   - relay fallback;
   - reconnect и retry.

3. **E2E:**
   - Double Ratchet для 1:1;
   - key verification/safety number;
   - session persistence;
   - rekey on new device.

4. **Offline:**
   - encrypted relay storage;
   - sync pending messages;
   - local SQLite cache;
   - idempotent event processing.

5. **Groups:**
   -第一阶段: group chat key distributed to members;
   -第二阶段: MLS for group E2E.

---

## P3 — локальное хранилище и CRDT/event log

Файлы:

- `client/services/p2p_local_store.py`
- `client/services/p2p_manager.py`

Задачи:

1. **Local SQLite schema:**
   - `peers`
   - `chats`
   - `chat_members`
   - `messages`
   - `attachments`
   - `crdt_events`
   - `backups`
   - `sessions`

2. **Event model:**
   - `event_id`
   - `chat_id`
   - `actor_id`
   - `op_type`
   - `lamport`
   - `vector_clock`
   - `payload`
   - `signature`

3. **Operations:**
   - `message.append`
   - `message.edit`
   - `message.delete`
   - `chat.member_add`
   - `chat.member_remove`
   - `attachment.add`
   - `read_receipt.update`

4. **Conflict rules:**
   - append-only messages;
   - edit/delete are tombstones;
   - last-writer-wins только для chat metadata;
   - membership changes подписываются creator/admin.

---

## P4 — медиа и файлы

Файлы:

- `client/services/message_logic.py`
- `client/services/media_manager.py`
- `server/routes/files.py`

Задачи:

1. **Server storage:**
   - encrypted file upload;
   - encrypted file download;
   - file metadata stored server-side;
   - content remains encrypted.

2. **Media UX:**
   - image preview;
   - video thumbnail;
   - document icon;
   - download/open;
   - retry failed transfer;
   - cancellation.

---

## P5 — federation и backup

Файлы:

- `client/services/p2p_backup.py`
- `server/routes/p2p.py`
- `server/core/models.py`

Задачи:

1. **Encrypted backup:**
   - backup key from recovery secret;
   - export chat history;
   - upload encrypted backup;
   - restore on new device.

2. **Federation mode:**
   - server stores only encrypted blobs;
   - relay offline messages;
   - optional home-server routing;
   - no plaintext access.

3. **Recovery UX:**
   - recovery phrase/password;
   - backup creation reminder;
   - restore wizard;
   - device verification.

---

## P6 — безопасность

Задачи:

1. **Key management:**
   - private keys only on client;
   - OS keychain или encrypted local storage;
   - no private key in server response;
   - rotate identity keys.

2. **Verification:**
   - safety number;
   - QR verification;
   - manual fingerprint compare;
   - warn on key change.

3. **Message security:**
   - Ed25519 signature per event;
   - Double Ratchet for 1:1;
   - MLS for groups;
   - replay protection by `event_id`.

4. **Server security:**
   - rate limiting;
   - audit logs without message content;
   - TURN auth;
   - monitoring;
   - backup encryption validation.

---

## P7 — UI/UX полноценного мессенджера

Экраны:

1. Login/Register
2. Chats list
3. Chat screen
4. Contacts
5. Add contact by username/id/QR
6. Group creation
7. Media gallery
8. Voice message preview/playback
9. Call screen
10. Call history
11. Settings
12. Privacy & Security
13. Backup & Restore
14. Device sessions
15. P2P status

UX-задачи:

- typing indicators;
- read receipts;
- online/offline;
- message status;
- search messages;
- search chats;
- pinned/muted chats;
- blocked users;
- notifications;
- offline banner;
- sync progress.

---

## P8 — инфраструктура

Нужно подготовить:

1. **Server:**
   - FastAPI deployment;
   - PostgreSQL instead of SQLite for production;
   - Redis for WebSocket presence;
   - background workers.

2. **TURN:**
   - coturn;
   - static/long-term auth credentials;
   - monitoring.

3. **Storage:**
   - S3/MinIO for encrypted files;
    - cleanup jobs.

4. **Monitoring:**
   - Prometheus;
   - Grafana;
   - structured logs;
   - alerting.

5. **CI/CD:**
   - tests;
   - type checks;
   - lint;
   - build desktop app;
   - migration scripts.

---

## Рекомендуемый протокол

### Для сообщений

Лучший выбор для NurChat:

**WebRTC DataChannel + WebSocket signalling/relay + Double Ratchet + SQLite CRDT event log**

Почему:

- WebRTC DataChannel даёт настоящий P2P realtime;
- WebSocket relay нужен для discovery, fallback и offline;
- Double Ratchet даёт forward secrecy и post-compromise security;
- SQLite event log даёт offline access и надёжную синхронизацию.

### Для звонков

- 1:1: **WebRTC P2P**
- group calls: позже **SFU**, например mediasoup/LiveKit/Janus

### Для файлов

- обычный режим: encrypted server storage
- advanced режим: encrypted storage with CRDT event log

### Для групп

-短期: group session key
- долгосрочно: **MLS**

---

## Приоритет реализации

1. Стабилизировать текущие сообщения/медиа/голосовые.
2. Довести звонки до рабочего WebRTC UI.
3. Включить P2P messaging с relay fallback.
4. Добавить CRDT/event log и offline queue.
5. Добавить backup/restore.
6. Перейти на MLS для групп.
8. Production deployment, monitoring, security audit.
