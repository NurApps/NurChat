import logging

from slowapi import Limiter
from slowapi.util import get_remote_address

from shared.config import settings

logger = logging.getLogger("nurchat")


def _storage_uri() -> str:
    """Redis-backed лимиты для мульти-инстанса, иначе память.

    In-memory лимиты обходятся за прокси/при нескольких воркерах (каждый
    процесс считает сам). При USE_REDIS=true делим счётчики через Redis;
    если Redis недоступен — честный fallback на память с warning, а не 500.
    """
    if not settings.USE_REDIS:
        return "memory://"
    try:
        import redis as _redis

        _redis.Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2).ping()
        return settings.REDIS_URL
    except Exception as exc:
        logger.warning("Redis unreachable (%s), rate limits fall back to in-memory", exc)
        return "memory://"


limiter = Limiter(key_func=get_remote_address, storage_uri=_storage_uri())


