import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from server.core.database import SessionLocal
from server.core.models import Message
from server.ws.chat_manager import connection_manager

logger = logging.getLogger(__name__)

_background_task = None
_running = False


async def _cleanup_expired_messages():
    """Delete messages that have passed their expires_at time."""
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        expired = db.query(Message).filter(
            Message.expires_at.isnot(None),
            Message.expires_at <= now,
            ~Message.is_deleted,
        ).all()

        for msg in expired:
            msg.is_deleted = True
            msg.deleted_for_all = True
            logger.info(f"[CLEANUP] Deleted expired message {msg.id} in chat {msg.chat_id}")

            await connection_manager.broadcast_to_chat({
                "event": "delete_message",
                "data": {
                    "message_id": msg.id,
                    "chat_id": msg.chat_id,
                    "delete_for_all": True,
                    "deleted_by": msg.user_id,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                },
            }, msg.chat_id)

        if expired:
            db.commit()
    except Exception as e:
        logger.error(f"[CLEANUP] Error: {e}")
        db.rollback()
    finally:
        db.close()


async def _send_scheduled_messages():
    """Send messages that are past their scheduled_at time."""
    db: Session = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        scheduled = db.query(Message).filter(
            Message.scheduled_at.isnot(None),
            Message.scheduled_at <= now,
            ~Message.is_deleted,
        ).all()

        for msg in scheduled:
            msg.scheduled_at = None
            logger.info(f"[SCHEDULE] Sending scheduled message {msg.id} in chat {msg.chat_id}")

            await connection_manager.broadcast_to_chat({
                "event": "new_message",
                "data": {
                    "id": msg.id,
                    "chat_id": msg.chat_id,
                    "user_id": msg.user_id,
                    "content": msg.content,
                    "message_type": msg.message_type,
                    "created_at": msg.created_at.isoformat() if msg.created_at else None,
                },
            }, msg.chat_id)

        if scheduled:
            db.commit()
    except Exception as e:
        logger.error(f"[SCHEDULE] Error: {e}")
        db.rollback()
    finally:
        db.close()


async def _deaf_relay_purge():
    """Глухой relay: физически удалять СОДЕРЖИМОЕ сообщений.

    Строка остаётся (id/чат/время — чтобы не ломать историю клиентов),
    но содержимое затирается:
    - delivered_at установлен (все получатели получили) → сразу
    - недоставленное старше MESSAGE_RETENTION_HOURS → по TTL
    """
    db: Session = SessionLocal()
    try:
        from shared.config import settings
        if not settings.RELAY_DEAF:
            return

        now = datetime.now(timezone.utc)
        retention_cutoff = now - timedelta(hours=settings.MESSAGE_RETENTION_HOURS)

        from sqlalchemy import and_, or_
        targets = db.query(Message).filter(
            Message.scheduled_at.is_(None),
            or_(
                Message.delivered_at.isnot(None),
                and_(
                    Message.delivered_at.is_(None),
                    Message.created_at < retention_cutoff,
                ),
            ),
            or_(
                Message.content != "[purged]",
                Message.encrypted_content.isnot(None),
            ),
        ).all()

        count = 0
        for msg in targets:
            msg.content = "[purged]"
            msg.encrypted_content = None
            msg.edit_history = None
            count += 1

        if count:
            db.commit()
            logger.info("[DEAF] Purged content of %d messages", count)
    except Exception as e:
        logger.error(f"[DEAF] Purge error: {e}")
        db.rollback()
    finally:
        db.close()


async def _background_loop():
    global _running
    _running = True
    logger.info("[BACKGROUND] Task loop started")

    while _running:
        try:
            await _cleanup_expired_messages()
            await _send_scheduled_messages()
            await _deaf_relay_purge()
        except Exception as e:
            logger.error(f"[BACKGROUND] Loop error: {e}")

        await asyncio.sleep(30)


def start_background_tasks():
    global _background_task
    loop = asyncio.get_event_loop()
    _background_task = loop.create_task(_background_loop())
    logger.info("[BACKGROUND] Tasks started")


def stop_background_tasks():
    global _running, _background_task
    _running = False
    if _background_task:
        _background_task.cancel()
    logger.info("[BACKGROUND] Tasks stopped")
