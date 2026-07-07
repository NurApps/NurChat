import asyncio
import logging
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from shared.constants import WS_EVENTS

from server.core.redis_manager import publish_presence, set_user_online, set_user_offline

from ..core import models
from ..core.database import SessionLocal
from ..core.security import security

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

    def disconnect(self, user_id: str):
        """Отключение пользователя"""
        if user_id in self.active_connections:
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
        """Синхронная версия обновления статуса"""
        import asyncio
        asyncio.create_task(self._update_user_online_status(user_id, is_online))

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
            import asyncio
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

    def get_online_users(self) -> list[str]:
        """Получение списка онлайн пользователей"""
        return list(self.active_connections.keys())

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
        # Валидируем данные
        if not all(k in data for k in ["chat_id", "content", "message_type"]):
            logger.warning(f"Invalid message data from {user_id}")
            return

        # Сохраняем сообщение в БД
        db: Session = SessionLocal()
        try:
            message_id = security.generate_message_id()
            message = models.Message(
                id=message_id,
                chat_id=data["chat_id"],
                user_id=user_id,
                content=data["content"],  # Уже зашифровано
                message_type=data["message_type"],
                file_id=data.get("file_id")
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
        except Exception as e:
            logger.error(f"Error saving message to DB: {e}")
            db.rollback()
            return
        finally:
            db.close()

        # Сервер больше не дешифрует сообщения - сообщения зашифрованы клиентом
        # Отправляем как есть, получатель расшифрует на своей стороне
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

        delete_event = {
            "event": WS_EVENTS["DELETE_MESSAGE"],
            "data": {
                "message_id": data["message_id"],
                "chat_id": data["chat_id"],
                "delete_for_all": data.get("delete_for_all", False),
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
                message.content = data["new_content"]
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
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        sent_to = await self.connection_manager.broadcast_to_chat(
            edit_event,
            data["chat_id"]
        )
        logger.info(f"Edit message {data['message_id']} by {user_id} notified to {len(sent_to)} users")

    async def send_sync_event(self, event_data: dict, chat_id: str, exclude_user: str = None):
        """Отправка события синхронизации всем участникам чата"""
        sync_event = {
            "event": WS_EVENTS["SYNC_EVENT"],  # Предполагаем, что SYNC_EVENT определен в constants
            "data": {
                **event_data,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        }

        sent_to = await self.connection_manager.broadcast_to_chat(
            sync_event,
            chat_id,
            exclude_user=exclude_user
        )

        logger.info(f"Sync event sent to {len(sent_to)} users in chat {chat_id}")
        return sent_to

# Глобальные экземпляры
connection_manager = ConnectionManager()
chat_manager = ChatManager(connection_manager)

async def handle_websocket_connection(websocket: WebSocket, user_id: str):
    """Основной обработчик WebSocket соединения"""
    await connection_manager.connect(websocket, user_id)

    try:
        while True:
            # Получаем сообщения от клиента
            data = await websocket.receive_json()
            await chat_manager.handle_message(user_id, data)

    except WebSocketDisconnect:
        connection_manager.disconnect(user_id)
    except Exception as e:
        logger.error(f"WebSocket error for {user_id}: {e}")
        connection_manager.disconnect(user_id)
