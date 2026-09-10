import json
import logging
import os

from shared.config import settings

logger = logging.getLogger("nurchat_redis")

_REDIS_UNAVAILABLE: bool = False
_redis_client = None


def _redis_enabled() -> bool:
    """Explicit switch: honor USE_REDIS env (pydantic types bool defaults as Literal)."""
    return os.getenv("USE_REDIS", "true").strip().lower() not in ("0", "false", "no")


def get_redis():
    global _redis_client, _REDIS_UNAVAILABLE
    if not _redis_enabled():
        return None
    if _REDIS_UNAVAILABLE:
        return None
    if _redis_client is not None:
        return _redis_client
    try:
        import redis as redis_module
        _redis_client = redis_module.from_url(
            settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=3,
            socket_timeout=3,
        )
        _redis_client.ping()
        logger.info("Connected to Redis at %s", settings.REDIS_URL)
        return _redis_client
    except Exception as exc:
        _REDIS_UNAVAILABLE = True
        logger.error(
            "Redis unavailable at %s — presence/online tracking degraded "
            "(explicit mode: USE_REDIS=%s). Fix REDIS_URL or set USE_REDIS=false: %s",
            settings.REDIS_URL, settings.USE_REDIS, exc,
        )
        return None


async def publish_presence(user_id: str, status: str):
    r = get_redis()
    if r is None:
        return
    try:
        channel = "nurchat:presence"
        r.publish(channel, json.dumps({"user_id": user_id, "status": status}))
    except Exception as exc:
        logger.debug("Redis publish error: %s", exc)


async def set_user_online(user_id: str):
    r = get_redis()
    if r is None:
        return
    try:
        r.sadd("nurchat:online_users", user_id)
        r.expire("nurchat:online_users", 3600)
    except Exception as exc:
        logger.debug("Redis set online error: %s", exc)


async def set_user_offline(user_id: str):
    r = get_redis()
    if r is None:
        return
    try:
        r.srem("nurchat:online_users", user_id)
    except Exception as exc:
        logger.debug("Redis set offline error: %s", exc)


def is_user_online(user_id: str) -> bool:
    r = get_redis()
    if r is None:
        return False
    try:
        return bool(r.sismember("nurchat:online_users", user_id))
    except Exception as exc:
        logger.debug("Redis is_user_online error: %s", exc)
        return False


def get_online_users() -> list[str]:
    r = get_redis()
    if r is None:
        return []
    try:
        return list(r.smembers("nurchat:online_users"))
    except Exception as exc:
        logger.debug("Redis get_online_users error: %s", exc)
        return []
