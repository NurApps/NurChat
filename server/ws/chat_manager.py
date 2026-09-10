import asyncio
import json as json_lib
import logging
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from server.core.redis_manager import publish_presence, set_user_offline, set_user_online
from shared.constants import WS_EVENTS

from ..core import models
from ..core.database import SessionLocal
from ..core.security import security
from ..utils.mentions import parse_mentions, resolve_mentioned_users

logger = logging.getLogger("nurchat_ws")

class ConnectionManager:
    """Менеджер WebSocket соединений для NurChat"""

    def __init__(self):
        # active_connections: {user_id: websocket}
        self.active_connections: dict[str, WebSocket] = {}
        # user_chats: {user_id: [chat_ids]}
        self.user_chats: dict[str, list[str]] = {}
        # chat_users: {chat_id: set(user_ids)} — reverse index for O(1) lookup
        self.chat_users: dict[str, set[str]] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        """Подключение пользователя к WebSocket"""
        # If a previous socket for this user is still open (reconnect overlap),
        # close it so the stale receive loop exits and can't ghost the session.
        old = self.active_connections.get(user_id)
        if old is not None and old is not websocket:
            try:
                await old.close(code=4000, reason="Replaced by new connection")
            except Exception:
                pass
        await websocket.accept()
        self.active_connections[user_id] = websocket

        # Загружаем чаты пользователя из БД
        await self._load_user_chats(user_id)

        # Обновляем статус онлайн
        await self._update_user_online_status(user_id, True)
        await self._notify_user_online(user_id)
        await set_user_online(user_id)
        await publish_presence(user_id, "online")

        logger.info(f"User {user_id} connected to WebSocket. Active chats: {len(self.user_chats.get(user_id, []))}")

    def disconnect(self, user_id: str, websocket: WebSocket | None = None):
        """Отключение пользователя.

        If `websocket` is given, only remove state when it still owns the slot —
        prevents a stale handler's disconnect from killing the fresh reconnect.
        """
        current = self.active_connections.get(user_id)
        if current is None:
            return
        if websocket is not None and current is not websocket:
            return  # a newer connection has already replaced this one
        del self.active_connections[user_id]
        # Clean up reverse index
        for cid in self.user_chats.get(user_id, []):
            if cid in self.chat_users:
                self.chat_users[cid].discard(user_id)
        # Обновляем статус оффлайн
        self._update_user_online_status_sync(user_id, False)
        self._notify_user_offline(user_id)
        asyncio.ensure_future(set_user_offline(user_id))
        asyncio.ensure_future(publish_presence(user_id, "offline"))

        logger.info(f"User {user_id} disconnected from WebSocket")

    async def _load_user_chats(self, user_id: str):
        """Загрузка чатов пользователя из БД"""
        db: Session = SessionLocal()
        try:
            user_chats = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.user_id == user_id
            ).all()

            chat_ids = [chat.chat_id for chat in user_chats]
            self.user_chats[user_id] = chat_ids
            # Update reverse index
            for cid in chat_ids:
                if cid not in self.chat_users:
                    self.chat_users[cid] = set()
                self.chat_users[cid].add(user_id)
            logger.debug(f"Loaded {len(chat_ids)} chats for user {user_id}")
        except Exception as e:
            logger.error(f"Error loading chats for user {user_id}: {e}")
            self.user_chats[user_id] = []
        finally:
            db.close()

    async def _update_user_online_status(self, user_id: str, is_online: bool):
        """Обновление статуса онлайн в БД"""
        db: Session = SessionLocal()
        try:
            user = db.query(models.User).filter(models.User.id == user_id).first()
            if user:
                user.is_online = is_online
                if not is_online:
                    user.last_seen = models.func.now()
                db.commit()
                logger.debug(f"User {user_id} online status updated to: {is_online}")
        except Exception as e:
            logger.error(f"Error updating online status for {user_id}: {e}")
            db.rollback()
        finally:
            db.close()

    def _update_user_online_status_sync(self, user_id: str, is_online: bool):
        """Синхронная версия обновления статуса — безопасный вызов"""
        try:
            loop = asyncio.get_running_loop()
            if loop.is_running():
                loop.create_task(self._update_user_online_status(user_id, is_online))
            else:
                asyncio.ensure_future(self._update_user_online_status(user_id, is_online))
        except RuntimeError:
            # No event loop running — do sync DB update directly
            db = SessionLocal()
            try:
                user = db.query(models.User).filter(models.User.id == user_id).first()
                if user:
                    user.is_online = is_online
                    if not is_online:
                        user.last_seen = models.func.now()
                    db.commit()
            except Exception:
                db.rollback()
            finally:
                db.close()

    async def _notify_user_online(self, user_id: str):
        """Уведомление о пользователе онлайн"""
        online_event = {
            "event": WS_EVENTS["USER_ONLINE"],
            "data": {
                "user_id": user_id,
                "is_online": True,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        await self._broadcast_to_user_chats(user_id, online_event)
        logger.debug(f"Notified chats about user {user_id} online")

    def _notify_user_offline(self, user_id: str):
        """Уведомление о пользователе оффлайн"""
        offline_event = {
            "event": WS_EVENTS["USER_OFFLINE"],
            "data": {
                "user_id": user_id,
                "is_online": False,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        self._broadcast_to_user_chats_sync(user_id, offline_event)
        logger.debug(f"Notified chats about user {user_id} offline")

    async def send_personal_message(self, message: dict, user_id: str):
        """Отправка личного сообщения пользователю"""
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
                return True
            except Exception as e:
                logger.error(f"Error sending to {user_id}: {e}")
                self.disconnect(user_id)
                return False
        return False

    async def broadcast_to_chat(self, message: dict, chat_id: str, exclude_user: str = None):
        """Отправка сообщения всем участникам чата — O(K) where K = users in chat"""
        sent_to = []
        members = self.chat_users.get(chat_id, set())
        for user_id in members:
            if user_id == exclude_user:
                continue
            websocket = self.active_connections.get(user_id)
            if websocket:
                try:
                    await websocket.send_json(message)
                    sent_to.append(user_id)
                except Exception as e:
                    logger.error(f"Error broadcasting to {user_id}: {e}")
                    self.disconnect(user_id)

        logger.debug(f"Broadcast to chat {chat_id} sent to {len(sent_to)} users: {sent_to}")
        return sent_to

    async def _broadcast_to_user_chats(self, user_id: str, message: dict):
        """Отправка сообщения во все чаты пользователя"""
        if user_id not in self.user_chats:
            return

        for chat_id in self.user_chats[user_id]:
            await self.broadcast_to_chat(message, chat_id, exclude_user=user_id)

    def _broadcast_to_user_chats_sync(self, user_id: str, message: dict):
        """Синхронная версия broadcast_to_user_chats"""
        if user_id not in self.user_chats:
            return

        for chat_id in self.user_chats[user_id]:
            asyncio.create_task(self.broadcast_to_chat(message, chat_id, exclude_user=user_id))

    def add_user_to_chat(self, user_id: str, chat_id: str):
        """Добавление пользователя в список чатов"""
        if user_id not in self.user_chats:
            self.user_chats[user_id] = []

        if chat_id not in self.user_chats[user_id]:
            self.user_chats[user_id].append(chat_id)
            # Update reverse index
            if chat_id not in self.chat_users:
                self.chat_users[chat_id] = set()
            self.chat_users[chat_id].add(user_id)
            logger.debug(f"User {user_id} added to chat {chat_id}")

    def remove_user_from_chat(self, user_id: str, chat_id: str):
        """Удаление пользователя из списка чатов"""
        if user_id in self.user_chats and chat_id in self.user_chats[user_id]:
            self.user_chats[user_id].remove(chat_id)
            # Update reverse index
            if chat_id in self.chat_users:
                self.chat_users[chat_id].discard(user_id)
            logger.debug(f"User {user_id} removed from chat {chat_id}")

    def is_user_online(self, user_id: str) -> bool:
        """Проверка онлайн статуса пользователя"""
        return user_id in self.active_connections

class ChatManager:
    """Менеджер чатов для обработки WebSocket сообщений"""

    def __init__(self, connection_manager: ConnectionManager):
        self.connection_manager = connection_manager

    async def handle_message(self, user_id: str, data: dict):
        """Обработка входящего сообщения"""
        try:
            event_type = data.get("event")

            if event_type == WS_EVENTS["MESSAGE"]:
                await self._handle_new_message(user_id, data["data"])
            elif event_type == WS_EVENTS["TYPING"]:
                await self._handle_typing(user_id, data["data"])
            elif event_type == WS_EVENTS["READ_RECEIPT"]:
                await self._handle_read_receipt(user_id, data["data"])
            elif event_type == WS_EVENTS["DELETE_MESSAGE"]:
                await self._handle_delete_message(user_id, data["data"])
            elif event_type == WS_EVENTS["EDIT_MESSAGE"]:
                await self._handle_edit_message(user_id, data["data"])
            elif event_type == "call_accept":
                await self._handle_call_accept_from_chat(user_id, data["data"])
            elif event_type == "call_reject":
                await self._handle_call_reject_from_chat(user_id, data["data"])
            else:
                logger.warning(f"Unknown event type from {user_id}: {event_type}")

        except Exception as e:
            logger.error(f"Error handling message from {user_id}: {e}")

    async def _handle_call_accept_from_chat(self, user_id: str, data: dict):
        """Принятие звонка из чата → перенаправление в call_manager"""
        call_id = data.get("call_id")
        if not call_id:
            return
        from server.ws.signaling import call_manager
        await call_manager._handle_call_accept(user_id, {"call_id": call_id})

    async def _handle_call_reject_from_chat(self, user_id: str, data: dict):
        """Отклонение звонка из чата → перенаправление в call_manager"""
        call_id = data.get("call_id")
        if not call_id:
            return
        from server.ws.signaling import call_manager
        await call_manager._handle_call_reject(user_id, {"call_id": call_id, "reason": "rejected"})

    async def _handle_new_message(self, user_id: str, data: dict):
        """Обработка нового сообщения"""
        # Валидируем данные — same constraints as the HTTP path (MessageCreate)
        if not all(k in data for k in ["chat_id", "content", "message_type"]):
            logger.warning(f"Invalid message data from {user_id}")
            return
        content = data["content"]
        message_type = data["message_type"]
        if not isinstance(content, str) or not (1 <= len(content) <= 5000):
            desc = len(content) if isinstance(content, str) else type(content).__name__
            logger.warning(f"Invalid content from {user_id}: {desc}")
            return
        allowed_types = {"text", "image", "video", "audio", "file", "location", "contact", "voice"}
        if message_type not in allowed_types:
            logger.warning(f"Invalid message_type from {user_id}: {message_type}")
            return

        # Глухой relay: принимаем ТОЛЬКО E2E-шифрованные сообщения (как HTTP-путь)
        from shared.config import settings as _settings
        if _settings.RELAY_DEAF and not data.get("encrypted_content"):
            logger.warning(f"RELAY_DEAF: rejected plaintext WS message from {user_id}")
            return

        # Сохраняем сообщение в БД
        db: Session = SessionLocal()
        try:
            # Verify sender is a participant of the chat
            sender_participant = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.chat_id == data["chat_id"],
                models.ChatParticipant.user_id == user_id
            ).first()
            if not sender_participant:
                logger.warning(f"User {user_id} is not a participant of chat {data['chat_id']}")
                return

            message_id = security.generate_message_id()
            message = models.Message(
                id=message_id,
                chat_id=data["chat_id"],
                user_id=user_id,
                content=content,
                message_type=message_type,
                file_id=data.get("file_id"),
                reply_to_id=data.get("reply_to_id"),
            )
            db.add(message)
            db.commit()
            participants = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.chat_id == data["chat_id"],
                models.ChatParticipant.user_id != user_id
            ).all()
            for participant in participants:
                db.add(models.MessageReadStatus(
                    message_id=message_id,
                    user_id=participant.user_id,
                    is_read=False
                ))
            db.commit()
            sender = db.query(models.User).filter(models.User.id == user_id).first()
            sender_username = sender.username if sender else "Unknown"
            logger.debug(f"Message {message_id} saved to DB")

            mentioned_usernames = parse_mentions(data.get("content", ""))
            if mentioned_usernames:
                mentioned_users = resolve_mentioned_users(db, mentioned_usernames, data["chat_id"])
                for mentioned in mentioned_users:
                    if mentioned.id == user_id:
                        continue
                    mention_event = {
                        "event": "mention",
                        "data": {
                            "chat_id": data["chat_id"],
                            "message_id": message_id,
                            "mentioned_by": user_id,
                            "mentioned_by_username": sender_username,
                            "content_preview": (data.get("content") or "")[:100],
                        }
                    }
                    await self.connection_manager.send_personal_message(mention_event, mentioned.id)
        except Exception as e:
            logger.error(f"Error saving message to DB: {e}")
            db.rollback()
            return
        finally:
            db.close()

        message_event = {
            "event": WS_EVENTS["MESSAGE"],
            "data": {
                **data,
                "id": message_id,
                "user_id": user_id,
                "username": sender_username,
                "encrypted_content": data.get("encrypted_content"),
                "signature": data.get("signature"),
                "timestamp": data.get("timestamp") or datetime.now(timezone.utc).isoformat()
            }
        }

        # Отправляем всем участникам чата, кроме отправителя
        sent_to = await self.connection_manager.broadcast_to_chat(
            message_event,
            data["chat_id"],
            exclude_user=user_id
        )

        # Подтверждение отправителю: message_delivered с реальным id
        delivered_event = {
            "event": WS_EVENTS["MESSAGE_DELIVERED"],
            "data": {
                "chat_id": data["chat_id"],
                "message_id": message_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }
        await self.connection_manager.send_personal_message(delivered_event, user_id)

        logger.info(f"Message from {user_id} in chat {data['chat_id']} saved and delivered to {len(sent_to)} users")

    async def _handle_typing(self, user_id: str, data: dict):
        """Обработка индикатора набора текста"""
        if not all(k in data for k in ["chat_id", "is_typing"]):
            return

        typing_event = {
            "event": WS_EVENTS["TYPING"],
            "data": {
                "chat_id": data["chat_id"],
                "user_id": user_id,
                "is_typing": data["is_typing"],
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        await self.connection_manager.broadcast_to_chat(
            typing_event,
            data["chat_id"],
            exclude_user=user_id
        )

        logger.debug(f"Typing event from {user_id} in chat {data['chat_id']}: {data['is_typing']}")

    async def _handle_read_receipt(self, user_id: str, data: dict):
        """Обработка подтверждения прочтения"""
        if not all(k in data for k in ["chat_id", "message_id"]):
            return

        read_event = {
            "event": WS_EVENTS["READ_RECEIPT"],
            "data": {
                "chat_id": data["chat_id"],
                "user_id": user_id,
                "message_id": data["message_id"],
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        await self.connection_manager.broadcast_to_chat(
            read_event,
            data["chat_id"],
            exclude_user=user_id
        )

        logger.debug(f"Read receipt from {user_id} for message {data['message_id']}")

    async def _handle_delete_message(self, user_id: str, data: dict):
        """Обработка удаления сообщения"""
        if not all(k in data for k in ["message_id", "chat_id"]):
            return

        delete_for_all = bool(data.get("delete_for_all", False))

        # Persist the deletion (only the author may delete for all)
        db: Session = SessionLocal()
        try:
            message = db.query(models.Message).filter(
                models.Message.id == data["message_id"],
                models.Message.chat_id == data["chat_id"],
            ).first()
            if message:
                if not delete_for_all or message.user_id == user_id:
                    message.is_deleted = True
                    if delete_for_all and message.user_id == user_id:
                        message.deleted_for_all = True
                    db.commit()
                else:
                    logger.warning(
                        f"User {user_id} tried to delete-for-all message {data['message_id']} of another user"
                    )
                    return
        finally:
            db.close()

        delete_event = {
            "event": WS_EVENTS["DELETE_MESSAGE"],
            "data": {
                "message_id": data["message_id"],
                "chat_id": data["chat_id"],
                "delete_for_all": delete_for_all,
                "deleted_by": user_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        # Отправляем всем участникам чата
        sent_to = await self.connection_manager.broadcast_to_chat(
            delete_event,
            data["chat_id"]
        )

        logger.info(f"Delete message {data['message_id']} by {user_id} notified to {len(sent_to)} users")

    async def _handle_edit_message(self, user_id: str, data: dict):
        """Обработка редактирования сообщения через WebSocket"""
        if not all(k in data for k in ["message_id", "chat_id", "new_content"]):
            return

        # Обновляем в БД
        db: Session = SessionLocal()
        try:
            message = db.query(models.Message).filter(
                models.Message.id == data["message_id"],
                models.Message.user_id == user_id
            ).first()
            if message:
                # Save to edit_history
                import json
                history = []
                if message.edit_history:
                    try:
                        history = json.loads(message.edit_history)
                    except (json.JSONDecodeError, TypeError):
                        history = []
                edited_at_str = (
                    message.edited_at.isoformat() if message.edited_at
                    else message.created_at.isoformat() if message.created_at
                    else None
                )
                history.append({
                    "content": message.content,
                    "edited_at": edited_at_str,
                })
                if len(history) > 50:
                    history = history[-50:]

                message.content = data["new_content"]
                message.edited_at = datetime.now(timezone.utc)
                message.edit_history = json.dumps(history, ensure_ascii=False)
                db.commit()
                logger.info(f"Message {data['message_id']} edited by {user_id}")
        except Exception as e:
            logger.error(f"Error editing message in DB: {e}")
            db.rollback()
        finally:
            db.close()

        edit_event = {
            "event": WS_EVENTS["EDIT_MESSAGE"],
            "data": {
                "message_id": data["message_id"],
                "chat_id": data["chat_id"],
                "new_content": data["new_content"],
                "edited_by": user_id,
                "edited_at": datetime.now(timezone.utc).isoformat(),
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        sent_to = await self.connection_manager.broadcast_to_chat(
            edit_event,
            data["chat_id"]
        )
        logger.info(f"Edit message {data['message_id']} by {user_id} notified to {len(sent_to)} users")

# Глобальные экземпляры
connection_manager = ConnectionManager()
chat_manager = ChatManager(connection_manager)

async def handle_websocket_connection(websocket: WebSocket, user_id: str, token: str | None = None):
    """Основной обработчик WebSocket соединения"""
    import time
    await connection_manager.connect(websocket, user_id)

    last_alive = time.monotonic()
    idle_timeout = 120       # probe after 2 min of silence
    dead_after = 300         # drop if silent for 5 min total
    last_token_check = 0.0
    token_check_interval = 10  # verify JWT every 10 seconds (on active messages)

    try:
        while True:
            try:
                raw = await asyncio.wait_for(websocket.receive_text(), timeout=idle_timeout)
            except asyncio.TimeoutError:
                now = time.monotonic()
                if now - last_alive > dead_after:
                    logger.info(f"Dropping dead WS connection for {user_id} (idle {int(now - last_alive)}s)")
                    break
                # Liveness probe — client replies with pong (updates last_alive)
                await websocket.send_json({"event": "ping"})
                continue

            last_alive = time.monotonic()

            if len(raw) > 1024 * 1024:
                logger.warning(f"Oversized WS message from {user_id}: {len(raw)} bytes")
                await websocket.send_json({"event": "error", "data": {"message": "Сообщение слишком большое"}})
                continue
            try:
                data = json_lib.loads(raw)
            except (json_lib.JSONDecodeError, ValueError):
                logger.warning(f"Invalid JSON from {user_id}: {raw[:200]}")
                await websocket.send_json({"event": "error", "data": {"message": "Невалидный JSON"}})
                continue

            # Token re-verification: check periodically, not on every message
            # to keep overhead minimal while catching revoked/expired tokens quickly.
            now = time.monotonic()
            if token and now - last_token_check > token_check_interval:
                last_token_check = now
                from server.core.security import AuthenticationError
                from server.core.security import security as sec
                try:
                    sec.verify_token(token)
                except AuthenticationError:
                    logger.info(f"Closing WS for {user_id}: token no longer valid")
                    await websocket.close(code=4001, reason="Token expired")
                    break

            await chat_manager.handle_message(user_id, data)

    except WebSocketDisconnect:
        connection_manager.disconnect(user_id, websocket)
    except Exception as e:
        logger.error(f"WebSocket error for {user_id}: {e}")
        connection_manager.disconnect(user_id, websocket)
