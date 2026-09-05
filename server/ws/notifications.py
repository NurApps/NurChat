import logging
from datetime import datetime, timezone

from fastapi import WebSocket

from ..core.security import security
from .chat_manager import connection_manager

logger = logging.getLogger("nurchat_ws")

class NotificationManager:
    """Менеджер уведомлений для NurChat"""

    def __init__(self):
        self.user_notifications: dict[str, list[dict]] = {}  # {user_id: [notifications]}
        self.max_notifications_per_user = 100

    async def send_message_notification(self, message_data: dict, target_user_ids: list[str]):
        """Отправка уведомления о новом сообщении"""
        notification = {
            "id": security.generate_message_id(),
            "type": "new_message",
            "title": "Новое сообщение",
            "body": self._truncate_message_preview(message_data.get("content", "")),
            "data": {
                "chat_id": message_data.get("chat_id"),
                "message_id": message_data.get("id"),
                "sender_id": message_data.get("user_id"),
                "message_type": message_data.get("message_type", "text")
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "read": False
        }

        for user_id in target_user_ids:
            await self._send_notification_to_user(user_id, notification)

    async def send_call_notification(self, call_data: dict, target_user_id: str):
        """Отправка уведомления о входящем звонке"""
        notification = {
            "id": security.generate_message_id(),
            "type": "incoming_call",
            "title": "Входящий звонок",
            "body": f"Входящий {call_data.get('call_type', 'аудио')} звонок",
            "data": {
                "call_id": call_data.get("call_id"),
                "caller_id": call_data.get("caller_id"),
                "call_type": call_data.get("call_type", "audio"),
                "chat_id": call_data.get("chat_id")
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "read": False
        }

        await self._send_notification_to_user(target_user_id, notification)

    async def send_system_notification(self, user_id: str, title: str, body: str, data: dict = None):
        """Отправка системного уведомления"""
        notification = {
            "id": security.generate_message_id(),
            "type": "system",
            "title": title,
            "body": body,
            "data": data or {},
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "read": False
        }

        await self._send_notification_to_user(user_id, notification)

    async def send_file_upload_notification(self, user_id: str, file_data: dict):
        """Уведомление о завершении загрузки файла"""
        notification = {
            "id": security.generate_message_id(),
            "type": "file_upload",
            "title": "Файл загружен",
            "body": f"Файл {file_data.get('filename')} успешно загружен",
            "data": {
                "file_id": file_data.get("file_id"),
                "filename": file_data.get("filename"),
                "file_size": file_data.get("file_size"),
                "file_type": file_data.get("file_type")
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "read": False
        }

        await self._send_notification_to_user(user_id, notification)

    async def send_group_invite_notification(self, invite_data: dict, target_user_id: str):
        """Отправка уведомления о приглашении в группу"""
        notification = {
            "id": security.generate_invite_id(),
            "type": "group_invite",
            "title": "Приглашение в группу",
            "body": f"Вас пригласили вступить в группу '{invite_data.get('group', {}).get('name', 'Без названия')}'",
            "data": {
                "invite_id": invite_data.get("id"),
                "group_id": invite_data.get("group_id"),
                "group_name": invite_data.get("group", {}).get("name"),
                "inviter_id": invite_data.get("inviter_id"),
                "inviter_name": invite_data.get("inviter", {}).get("username"),
                "status": invite_data.get("status", "pending")
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "read": False
        }

        await self._send_notification_to_user(target_user_id, notification)

    async def _send_notification_to_user(self, user_id: str, notification: dict):
        """Отправка уведомления конкретному пользователю"""
        # Сохраняем уведомление в истории
        self._store_notification(user_id, notification)

        # Отправляем через WebSocket если пользователь онлайн
        if user_id in connection_manager.active_connections:
            try:
                ws_message = {
                    "event": "notification",
                    "data": notification
                }
                await connection_manager.active_connections[user_id].send_json(ws_message)
                logger.debug(f"Notification sent to user {user_id}: {notification['type']}")
            except Exception as e:
                logger.error(f"Error sending notification to {user_id}: {e}")
                connection_manager.disconnect(user_id)
        else:
            # User offline — send Web Push notification (in thread to avoid blocking)
            try:
                import asyncio

                from server.routes.push import send_push_notification
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(
                    None,
                    lambda: send_push_notification(
                        user_id=user_id,
                        title=notification.get("title", "NurChat"),
                        body=notification.get("body", ""),
                        data=notification.get("data"),
                    ),
                )
            except Exception as e:
                logger.error(f"Push notification failed for {user_id}: {e}")
            logger.debug(f"User {user_id} is offline, push sent")

    def _store_notification(self, user_id: str, notification: dict):
        """Сохранение уведомления в истории"""
        if user_id not in self.user_notifications:
            self.user_notifications[user_id] = []

        # Добавляем в начало списка
        self.user_notifications[user_id].insert(0, notification)

        # Ограничиваем количество уведомлений
        if len(self.user_notifications[user_id]) > self.max_notifications_per_user:
            self.user_notifications[user_id] = self.user_notifications[user_id][:self.max_notifications_per_user]

    def get_user_notifications(self, user_id: str, limit: int = 50) -> list[dict]:
        """Получение уведомлений пользователя"""
        if user_id not in self.user_notifications:
            return []

        return self.user_notifications[user_id][:limit]

    def mark_notification_as_read(self, user_id: str, notification_id: str):
        """Пометить уведомление как прочитанное"""
        if user_id in self.user_notifications:
            for notification in self.user_notifications[user_id]:
                if notification["id"] == notification_id:
                    notification["read"] = True
                    break

    def clear_user_notifications(self, user_id: str):
        """Очистка всех уведомлений пользователя"""
        if user_id in self.user_notifications:
            self.user_notifications[user_id].clear()

    def _truncate_message_preview(self, content: str, max_length: int = 100) -> str:
        """Обрезка текста сообщения для превью"""
        if len(content) <= max_length:
            return content
        return content[:max_length] + "..."

    def _get_chat_participants(self, chat_id: str) -> list[str]:
        """Получение участников чата из БД"""
        from ..core import models
        from ..core.database import SessionLocal

        db = SessionLocal()

        try:
            participants = db.query(models.ChatParticipant).filter(
                models.ChatParticipant.chat_id == chat_id
            ).all()

            return [p.user_id for p in participants]
        except Exception as e:
            logger.error(f"Error getting chat participants for chat {chat_id}: {e}")
            return []
        finally:
            db.close()

# Глобальный экземпляр
notification_manager = NotificationManager()

# WebSocket endpoint для уведомлений
async def handle_notifications_websocket(websocket: WebSocket, user_id: str):
    """WebSocket endpoint для уведомлений"""
    await websocket.accept()

    try:
        # Отправляем историю уведомлений при подключении
        notifications = notification_manager.get_user_notifications(user_id)
        await websocket.send_json({
            "event": "notifications_history",
            "data": notifications
        })

        while True:
            # Ожидаем команды от клиента
            data = await websocket.receive_json()
            command = data.get("command")

            if command == "mark_as_read":
                notification_id = data.get("notification_id")
                notification_manager.mark_notification_as_read(user_id, notification_id)

                # Подтверждаем клиенту
                await websocket.send_json({
                    "event": "notification_updated",
                    "data": {"notification_id": notification_id, "read": True}
                })

            elif command == "clear_all":
                notification_manager.clear_user_notifications(user_id)
                await websocket.send_json({
                    "event": "notifications_cleared"
                })

            elif command == "get_history":
                limit = data.get("limit", 50)
                notifications = notification_manager.get_user_notifications(user_id, limit)
                await websocket.send_json({
                    "event": "notifications_history",
                    "data": notifications
                })

    except Exception as e:
        logger.error(f"WebSocket error in notifications for {user_id}: {e}")
    finally:
        await websocket.close()
