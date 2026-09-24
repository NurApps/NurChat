"""Cross-instance WS bus over Redis pub/sub.

Одноинстансовый деплой (SQLite дома, USE_REDIS=false или Redis недоступен):
шина — no-op, доставка только локальная, поведение как раньше.

Мультиинстанс (прод compose): каждый broadcast_to_chat / send_personal_message
дополнительно публикуется в Redis; поток-подписчик каждого инстанса забирает
чужие фреймы (origin != INSTANCE_ID) и доставляет их локальным сокетам.
Без этого второй инстанс за балансировщиком никого не находит.

Формат фреймов — тот же JSON, что уходит в сокеты, плюс origin/chat_id/target.
"""

import asyncio
import json
import logging
import threading
import uuid

logger = logging.getLogger("nurchat_bus")

INSTANCE_ID = uuid.uuid4().hex

CHAT_CHANNEL = "nurchat:bus_chat"
PERSONAL_CHANNEL = "nurchat:bus_personal"

_sub_thread: threading.Thread | None = None
_stop_event = threading.Event()


def _publish(channel: str, payload: dict) -> bool:
    """Best-effort публикация. False = шины нет, только локальная доставка."""
    from server.core.redis_manager import get_redis
    r = get_redis()
    if r is None:
        return False
    try:
        r.publish(channel, json.dumps(payload, ensure_ascii=False))
        return True
    except Exception as exc:
        logger.debug("Bus publish error on %s: %s", channel, exc)
        return False


def publish_chat(chat_id: str, message: dict, exclude_user: str | None = None) -> bool:
    return _publish(CHAT_CHANNEL, {
        "origin": INSTANCE_ID,
        "chat_id": chat_id,
        "exclude_user": exclude_user,
        "message": message,
    })


def publish_personal(target_user_id: str, message: dict) -> bool:
    return _publish(PERSONAL_CHANNEL, {
        "origin": INSTANCE_ID,
        "target_user_id": target_user_id,
        "message": message,
    })


def _listen_loop(loop: asyncio.AbstractEventLoop, connection_manager) -> None:
    """Живёт в отдельном потоке: свой sync redis-клиент, get_message с таймаутом."""
    try:
        import redis as redis_module

        from shared.config import settings
        client = redis_module.from_url(
            settings.REDIS_URL, decode_responses=True,
            socket_connect_timeout=5, socket_timeout=5,
        )
        pubsub = client.pubsub(ignore_subscribe_messages=True)
        pubsub.subscribe(CHAT_CHANNEL, PERSONAL_CHANNEL)
    except Exception as exc:
        logger.warning("Bus subscriber not started (Redis unavailable): %s", exc)
        return

    logger.info("Bus subscriber started (instance %s)", INSTANCE_ID[:8])
    try:
        while not _stop_event.is_set():
            try:
                frame = pubsub.get_message(timeout=1.0)
            except Exception as exc:
                logger.debug("Bus get_message error: %s", exc)
                _stop_event.wait(2.0)
                continue
            if not frame:
                continue
            try:
                payload = json.loads(frame["data"])
            except (json.JSONDecodeError, TypeError):
                continue
            if payload.get("origin") == INSTANCE_ID:
                continue  # свой фрейм уже доставлен локально издателем
            try:
                fut = asyncio.run_coroutine_threadsafe(
                    _deliver(connection_manager, frame["channel"], payload), loop
                )
                fut.result(timeout=5)
            except Exception as exc:
                logger.debug("Bus deliver error: %s", exc)
    finally:
        try:
            pubsub.close()
            client.close()
        except Exception:
            pass
        logger.info("Bus subscriber stopped")


async def _deliver(connection_manager, channel: str, payload: dict) -> None:
    if channel == CHAT_CHANNEL:
        await connection_manager.broadcast_local(
            payload["message"], payload["chat_id"],
            exclude_user=payload.get("exclude_user"),
        )
    elif channel == PERSONAL_CHANNEL:
        await connection_manager.send_local(
            payload["message"], payload["target_user_id"]
        )


def start_bus(loop: asyncio.AbstractEventLoop, connection_manager) -> None:
    """Вызывать из lifespan. Без Redis — поток сразу гаснет с warning."""
    from shared.config import settings
    if not settings.USE_REDIS:
        logger.info("Bus subscriber skipped (USE_REDIS=false, single instance)")
        return
    global _sub_thread
    if _sub_thread is not None and _sub_thread.is_alive():
        return
    _stop_event.clear()
    _sub_thread = threading.Thread(
        target=_listen_loop, args=(loop, connection_manager),
        name="nurchat-bus", daemon=True,
    )
    _sub_thread.start()


def stop_bus() -> None:
    _stop_event.set()
