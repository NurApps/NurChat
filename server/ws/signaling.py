import logging
from datetime import datetime, timezone

from fastapi import WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session

from shared.constants import CALL_STATUS

from ..core import models
from ..core.database import SessionLocal
from .chat_manager import connection_manager
from .notifications import notification_manager

logger = logging.getLogger("nurchat_ws")

class CallManager:
    """Менеджер звонков через WebRTC для NurChat"""

    def __init__(self):
        self.active_calls: dict[str, dict] = {}  # {call_id: call_data}
        self.user_calls: dict[str, str] = {}     # {user_id: call_id}
        self.call_websockets: dict[str, WebSocket] = {}  # {user_id: websocket}
        self.pending_messages: dict[str, list[dict]] = {}  # {user_id: [messages]}

    async def handle_signaling(self, websocket: WebSocket, user_id: str):
        """Обработка WebRTC сигналов"""
        await websocket.accept()
        self.call_websockets[user_id] = websocket

        await self._flush_pending_messages(user_id)

        logger.info(f"User {user_id} connected to signaling WebSocket")

        try:
            while True:
                data = await websocket.receive_json()
                message_type = data.get("type")

                logger.debug(f"Signaling message from {user_id}: {message_type}")

                if message_type == "offer":
                    await self._handle_offer(user_id, data)
                elif message_type == "answer":
                    await self._handle_answer(user_id, data)
                elif message_type == "ice-candidate":
                    await self._handle_ice_candidate(user_id, data)
                elif message_type == "call-request":
                    await self._handle_call_request(user_id, data)
                elif message_type == "call-join":
                    await self._handle_call_join(user_id, data)
                elif message_type == "call-accept":
                    await self._handle_call_accept(user_id, data)
                elif message_type == "call-reject":
                    await self._handle_call_reject(user_id, data)
                elif message_type == "call-end":
                    await self._handle_call_end(user_id, data)
                elif message_type == "call-timeout":
                    await self._handle_call_timeout(user_id, data)
                else:
                    logger.warning(f"Unknown signaling type from {user_id}: {message_type}")

        except WebSocketDisconnect:
            await self._handle_call_disconnect(user_id)
        except Exception as e:
            logger.error(f"Signaling error for {user_id}: {e}")
            await self._handle_call_disconnect(user_id)
        finally:
            if user_id in self.call_websockets:
                del self.call_websockets[user_id]

    async def _handle_call_join(self, user_id: str, data: dict):
        """Обработка присоединения к существующему звонку (callee)"""
        call_id = data.get("call_id")
        if not call_id:
            return

        call = self.active_calls.get(call_id)
        if not call:
            await self._send_to_user(user_id, {
                "type": "call-failed",
                "call_id": call_id,
                "reason": "call_not_found",
                "message": "Звонок не найден"
            })
            return

        logger.info(f"User {user_id} joined call {call_id}")

    async def _handle_call_request(self, user_id: str, data: dict):
        """Обработка запроса на звонок"""
        target_user_id = data["target_user_id"]
        call_id = data["call_id"]
        call_type = data.get("call_type", "audio")

        # Проверяем, что целевой пользователь существует и онлайн
        if not connection_manager.is_user_online(target_user_id):
            await self._send_to_user(user_id, {
                "type": "call-failed",
                "call_id": call_id,
                "reason": "user_offline",
                "message": "Пользователь не в сети"
            })
            return

        # Проверяем, что целевой пользователь не в другом звонке
        if target_user_id in self.user_calls:
            await self._send_to_user(user_id, {
                "type": "call-failed",
                "call_id": call_id,
                "reason": "user_busy",
                "message": "Пользователь занят"
            })
            return

        self.active_calls[call_id] = {
            "caller_id": user_id,
            "callee_id": target_user_id,
            "call_type": call_type,
            "status": CALL_STATUS["RINGING"],
            "started_at": datetime.now(timezone.utc)
        }

        self.user_calls[user_id] = call_id
        self.user_calls[target_user_id] = call_id

        # Если callee подключён к calls WS — отправляем напрямую
        if target_user_id in self.call_websockets:
            call_request = {
                "type": "call-request",
                "call_id": call_id,
                "caller_id": user_id,
                "call_type": call_type,
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            success = await self._send_to_user(target_user_id, call_request)
        else:
            # Отправляем через chat WS (модалка входящего звонка)
            caller_name = user_id  # fallback
            try:
                db = SessionLocal()
                caller = db.query(models.User).filter(models.User.id == user_id).first()
                if caller:
                    caller_name = caller.username or caller.first_name or user_id
                db.close()
            except Exception:
                pass

            call_incoming_event = {
                "event": "call_incoming",
                "data": {
                    "call_id": call_id,
                    "caller_id": user_id,
                    "caller_name": caller_name,
                    "call_type": call_type,
                    "timestamp": datetime.now(timezone.utc).isoformat()
                }
            }
            await connection_manager.send_personal_message(call_incoming_event, target_user_id)
            success = True

        if success:
            await self._send_to_user(user_id, {
                "type": "call-request-sent",
                "call_id": call_id,
                "message": "Запрос звонка отправлен"
            })
            logger.info(f"Call request from {user_id} to {target_user_id} (call_id: {call_id})")
        else:
            self._cleanup_call(call_id)
            await self._send_to_user(user_id, {
                "type": "call-failed",
                "call_id": call_id,
                "reason": "delivery_failed",
                "message": "Не удалось отправить запрос"
            })

    async def _handle_call_accept(self, user_id: str, data: dict):
        """Обработка принятия звонка"""
        call_id = data["call_id"]
        call = self.active_calls.get(call_id)

        if not call or call["callee_id"] != user_id:
            await self._send_to_user(user_id, {
                "type": "call-error",
                "call_id": call_id,
                "message": "Звонок не найден"
            })
            return

        if call["status"] != CALL_STATUS["RINGING"]:
            await self._send_to_user(user_id, {
                "type": "call-error",
                "call_id": call_id,
                "message": "Невозможно принять этот звонок"
            })
            return

        call["status"] = CALL_STATUS["ACTIVE"]

        # Уведомляем звонящего о принятии
        call_accepted = {
            "type": "call-accepted",
            "call_id": call_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        success = await self._send_to_user(call["caller_id"], call_accepted)

        if success:
            logger.info(f"Call {call_id} accepted by {user_id}")

            # Сохраняем в БД
            await self._save_call_to_db(call_id, "accepted")
        else:
            # Если не удалось уведомить, завершаем звонок
            await self._handle_call_end(user_id, {"call_id": call_id})

    async def _handle_call_reject(self, user_id: str, data: dict):
        """Обработка отклонения звонка"""
        call_id = data["call_id"]
        call = self.active_calls.get(call_id)

        if not call:
            return

        reason = data.get("reason", "rejected")

        # Уведомляем звонящего об отклонении
        call_rejected = {
            "type": "call-rejected",
            "call_id": call_id,
            "reason": reason,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        await self._send_to_user(call["caller_id"], call_rejected)

        # Уведомление о пропущенном звонке для caller
        try:
            await notification_manager.send_system_notification(
                user_id=call["caller_id"],
                title="Пропущенный звонок",
                body="Звонок отклонён",
            )
        except Exception as e:
            logger.error(f"Missed call notification error: {e}")

        # Сохраняем в БД
        await self._save_call_to_db(call_id, "rejected", reason)

        # Очищаем данные звонка
        self._cleanup_call(call_id)
        logger.info(f"Call {call_id} rejected by {user_id}, reason: {reason}")

    async def _handle_call_end(self, user_id: str, data: dict):
        """Обработка завершения звонка"""
        call_id = data["call_id"]
        call = self.active_calls.get(call_id)

        if not call:
            return

        # Уведомляем второго участника о завершении
        call_ended = {
            "type": "call-ended",
            "call_id": call_id,
            "ended_by": user_id,
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        other_user = call["callee_id"] if user_id == call["caller_id"] else call["caller_id"]
        await self._send_to_user(other_user, call_ended)

        duration = None
        if call["status"] == CALL_STATUS["ACTIVE"] and call.get("started_at"):
            duration = int((datetime.now(timezone.utc) - call["started_at"]).total_seconds())

        await self._save_call_to_db(call_id, "ended", ended_by=user_id, duration=duration)

        self._cleanup_call(call_id)
        logger.info(f"Call {call_id} ended by {user_id}, duration: {duration}")

    async def _handle_call_timeout(self, user_id: str, data: dict):
        """Обработка таймаута звонка"""
        call_id = data["call_id"]
        call = self.active_calls.get(call_id)

        if not call or call["caller_id"] != user_id:
            return

        if call["status"] == CALL_STATUS["RINGING"]:
            # Уведомляем целевого пользователя о таймауте
            await self._send_to_user(call["callee_id"], {
                "type": "call-timeout",
                "call_id": call_id,
                "timestamp": datetime.now(timezone.utc).isoformat()
            })

            # Уведомление о пропущенном звонке
            try:
                await notification_manager.send_system_notification(
                    user_id=user_id,
                    title="Пропущенный звонок",
                    body="Абонент не ответил",
                )
                await notification_manager.send_system_notification(
                    user_id=call["callee_id"],
                    title="Пропущенный звонок",
                    body="Вам звонили",
                )
            except Exception as e:
                logger.error(f"Missed call notification error: {e}")

            # Сохраняем в БД как пропущенный
            await self._save_call_to_db(call_id, "missed", "timeout")

            self._cleanup_call(call_id)
            logger.info(f"Call {call_id} timed out")

    async def _handle_offer(self, user_id: str, data: dict):
        """Обработка WebRTC offer"""
        target_user_id = self._get_call_partner(user_id)
        if target_user_id:
            await self._send_to_user(target_user_id, data)

    async def _handle_answer(self, user_id: str, data: dict):
        """Обработка WebRTC answer"""
        target_user_id = self._get_call_partner(user_id)
        if target_user_id:
            await self._send_to_user(target_user_id, data)

    async def _handle_ice_candidate(self, user_id: str, data: dict):
        """Обработка ICE candidate"""
        target_user_id = self._get_call_partner(user_id)
        if target_user_id:
            await self._send_to_user(target_user_id, data)

    async def _handle_call_disconnect(self, user_id: str):
        """Обработка отключения пользователя во время звонка"""
        call_id = self.user_calls.get(user_id)
        if call_id:
            await self._handle_call_end(user_id, {"call_id": call_id})

    def _get_call_partner(self, user_id: str) -> str | None:
        """Получение ID второго участника звонка"""
        call_id = self.user_calls.get(user_id)
        if not call_id:
            return None

        call = self.active_calls.get(call_id)
        if not call:
            return None

        if user_id == call["caller_id"]:
            return call["callee_id"]
        else:
            return call["caller_id"]

    async def _send_to_user(self, user_id: str, message: dict) -> bool:
        """Отправка сообщения пользователю через WebSocket"""
        if user_id in self.call_websockets:
            try:
                await self.call_websockets[user_id].send_json(message)
                return True
            except Exception as e:
                logger.error(f"Error sending signaling to {user_id}: {e}")
                if user_id in self.call_websockets:
                    del self.call_websockets[user_id]
                return False
        else:
            if user_id not in self.pending_messages:
                self.pending_messages[user_id] = []
            self.pending_messages[user_id].append(message)
            logger.debug(f"Buffered message for {user_id} (not on calls WS yet)")
            return True

    async def _flush_pending_messages(self, user_id: str):
        """Отправка буферизированных сообщений при подключении"""
        if user_id in self.pending_messages:
            messages = self.pending_messages.pop(user_id)
            for msg in messages:
                if user_id in self.call_websockets:
                    try:
                        await self.call_websockets[user_id].send_json(msg)
                    except Exception:
                        break

    async def _save_call_to_db(self, call_id: str, action: str, reason: str = None, duration: float = None, ended_by: str = None):
        call = self.active_calls.get(call_id)
        if not call:
            return

        db: Session = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            call_log = models.CallLog(
                call_id=call_id,
                caller_id=call["caller_id"],
                callee_id=call["callee_id"],
                call_type=call["call_type"],
                started_at=call["started_at"],
                ended_at=now,
                duration=duration or 0,
                ended_by=ended_by or call["caller_id"]
            )

            db.add(call_log)
            db.commit()
            logger.debug(f"Call {call_id} saved to DB with action: {action}")

        except Exception as e:
            logger.error(f"Error saving call {call_id} to DB: {e}")
            db.rollback()
        finally:
            db.close()

    def _cleanup_call(self, call_id: str):
        """Очистка данных звонка"""
        if call_id in self.active_calls:
            call = self.active_calls[call_id]
            if call["caller_id"] in self.user_calls:
                del self.user_calls[call["caller_id"]]
            if call["callee_id"] in self.user_calls:
                del self.user_calls[call["callee_id"]]
            del self.active_calls[call_id]

# Глобальный экземпляр
call_manager = CallManager()
