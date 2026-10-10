"""Cloudflare Turnstile server-side verification (siteverify)."""
from datetime import datetime, timedelta, timezone

import httpx

from server.utils.logger import logger
from shared.config import settings

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SIGNUP_ACTION = "signup"
# Токены Turnstile длинные (JWT-подобные, обычно ~2 КБ, бывают больше).
# Слишком низкий кап молча отбивал РЕАЛЬНЫЕ решения: виджет «успешно»,
# а сервер отвечал «Неверная CAPTCHA» без единой строки в логе.
_MAX_TOKEN_LEN = 8192

# Официальные тестовые секреты Cloudflare (доки: troubleshooting/testing).
# Их siteverify принимает ЛЮБОЙ токен и отвечает success БЕЗ action/hostname
# реальной страницы (hostname всегда example.com) — проверять action/hostname
# там нечего. Это не дыра: тестовый secret НЕ валидирует настоящие токены
# и наоборот, так что в проде с настоящим секретом ветка недостижима.
# См. баг: «виджет успешен, сервер отвечает Неверная CAPTCHA».
_TEST_SECRETS = frozenset({
    "1x0000000000000000000000000000000AA",  # always passes
    "2x0000000000000000000000000000000AA",  # always fails (через success=False)
})


class LockoutManager:
    """Брутфорс-защита уровня IP/аккаунта (pentest #5/#6): после серии
    неудач (неверная капча, неверный пароль) ключ блокируется.

    Хранилище — Redis sorted-set при USE_REDIS (общий счётчик на
    мульти-инстанс, переживает рестарт), иначе in-memory dict.
    Любая ошибка Redis — тихий fallback на память, не 500.
    """

    _REDIS_PREFIX = "nurchat:lockout:"

    def __init__(self) -> None:
        self._failures: dict[str, list[datetime]] = {}
        self.lockout_threshold = 10
        self.lockout_window = timedelta(minutes=15)
        self.lockout_seconds = 300

    def _rkey(self, key: str) -> str:
        return self._REDIS_PREFIX + key

    def _redis(self):
        try:
            from server.core.redis_manager import get_redis
            return get_redis()
        except Exception:
            return None

    def is_locked_out(self, key: str) -> bool:
        if self._is_locked_out_redis(key):
            return True
        return self._is_locked_out_mem(key)

    def _is_locked_out_redis(self, key: str) -> bool:
        r = self._redis()
        if r is None:
            return False
        try:
            import time
            now = time.time()
            rk = self._rkey(key)
            window_start = now - self.lockout_window.total_seconds()
            r.zremrangebyscore(rk, 0, window_start)
            if r.zcard(rk) < self.lockout_threshold:
                return False
            latest = r.zrevrange(rk, 0, 0, withscores=True)
            if not latest:
                return False
            return bool((now - latest[0][1]) < self.lockout_seconds)
        except Exception:
            return False

    def _is_locked_out_mem(self, key: str) -> bool:
        now = datetime.now(timezone.utc)
        hits = [t for t in self._failures.get(key, []) if now - t < self.lockout_window]
        self._failures[key] = hits
        if len(hits) < self.lockout_threshold:
            return False
        # Блок держится lockout_seconds с ПОСЛЕДНЕЙ неудачи (скользящее окно).
        return (now - hits[-1]).total_seconds() < self.lockout_seconds

    def record_failure(self, key: str) -> None:
        self._record_failure_redis(key)
        self._record_failure_mem(key)

    def _record_failure_redis(self, key: str) -> None:
        r = self._redis()
        if r is None:
            return
        try:
            import time
            import uuid
            now = time.time()
            rk = self._rkey(key)
            r.zadd(rk, {uuid.uuid4().hex: now})
            r.zremrangebyscore(rk, 0, now - self.lockout_window.total_seconds())
            r.expire(rk, int(self.lockout_window.total_seconds()) + self.lockout_seconds)
        except Exception:
            pass

    def _record_failure_mem(self, key: str) -> None:
        now = datetime.now(timezone.utc)
        hits = [t for t in self._failures.get(key, []) if now - t < self.lockout_window]
        hits.append(now)
        self._failures[key] = hits

    def record_success(self, key: str) -> None:
        try:
            r = self._redis()
            if r is not None:
                r.delete(self._rkey(key))
        except Exception:
            pass
        self._failures.pop(key, None)


lockout_manager = LockoutManager()


def _allowed_hostnames() -> set[str]:
    return {h.strip() for h in settings.TURNSTILE_HOSTNAMES.split(",") if h.strip()}


async def verify_turnstile(token: str, expected_action: str) -> bool:
    if settings.DISABLE_CAPTCHA:
        # Локальный dev без Cloudflare (см. shared/config.py).
        # Прод остаётся fail-closed: флаг по умолчанию false.
        logger.warning("CAPTCHA disabled via DISABLE_CAPTCHA — registration is unprotected")
        return True
    hostnames = _allowed_hostnames()
    if not settings.TURNSTILE_SECRET or not hostnames:
        logger.error("Turnstile not configured: TURNSTILE_SECRET and TURNSTILE_HOSTNAMES are required")
        return False
    if not isinstance(token, str) or not token or len(token) > _MAX_TOKEN_LEN:
        # Длину — в лог (не содержимое): иначе повтор бага с тихим отказом
        # недиагностируем. Пустой токен = виджет не решали/протух на клиенте.
        logger.warning(
            "Turnstile token rejected before siteverify: len=%d (empty=%s)",
            len(token) if isinstance(token, str) else -1,
            not token,
        )
        return False

    # remoteip не передаём: глухой релей не хранит и не раздаёт IP клиентов.
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(
                SITEVERIFY_URL,
                data={"secret": settings.TURNSTILE_SECRET, "response": token},
            )
        r.raise_for_status()
        result = r.json()
    except (httpx.HTTPError, ValueError) as e:
        logger.warning(f"Turnstile siteverify unavailable: {e}")
        return False

    if not isinstance(result, dict):
        return False
    if settings.TURNSTILE_SECRET in _TEST_SECRETS:
        # Тестовый режим Cloudflare: привязки к странице нет, верим success.
        ok = result.get("success") is True
        if not ok:
            logger.warning(
                "Turnstile TEST-KEY rejected: success=%s errors=%s",
                result.get("success"), result.get("error-codes"),
            )
        return ok
    ok = (
        result.get("success") is True
        and result.get("action") == expected_action
        and result.get("hostname") in hostnames
    )
    if not ok:
        logger.warning(
            "Turnstile rejected: success=%s errors=%s action=%r hostname=%r",
            result.get("success"), result.get("error-codes"), result.get("action"), result.get("hostname"),
        )
    return ok
