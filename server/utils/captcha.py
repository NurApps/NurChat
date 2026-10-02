"""Cloudflare Turnstile server-side verification (siteverify)."""
from datetime import datetime, timedelta, timezone

import httpx

from server.utils.logger import logger
from shared.config import settings

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SIGNUP_ACTION = "signup"
_MAX_TOKEN_LEN = 2048


class LockoutManager:
    """Брутфорс-защита уровня IP/аккаунта (pentest #5/#6): после серии
    неудач (неверная капча, неверный пароль) ключ блокируется.

    In-memory per-process — как весь slowapi здесь; для мульти-инстанса
    нужен Redis (см. USE_REDIS).
    """

    def __init__(self) -> None:
        self._failures: dict[str, list[datetime]] = {}
        self.lockout_threshold = 10
        self.lockout_window = timedelta(minutes=15)
        self.lockout_seconds = 300

    def is_locked_out(self, key: str) -> bool:
        now = datetime.now(timezone.utc)
        hits = [t for t in self._failures.get(key, []) if now - t < self.lockout_window]
        self._failures[key] = hits
        if len(hits) < self.lockout_threshold:
            return False
        # Блок держится lockout_seconds с ПОСЛЕДНЕЙ неудачи (скользящее окно).
        return (now - hits[-1]).total_seconds() < self.lockout_seconds

    def record_failure(self, key: str) -> None:
        now = datetime.now(timezone.utc)
        hits = [t for t in self._failures.get(key, []) if now - t < self.lockout_window]
        hits.append(now)
        self._failures[key] = hits

    def record_success(self, key: str) -> None:
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
