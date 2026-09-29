"""Cloudflare Turnstile server-side verification (siteverify)."""
import httpx

from server.utils.logger import logger
from shared.config import settings

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SIGNUP_ACTION = "signup"
_MAX_TOKEN_LEN = 2048


def _allowed_hostnames() -> set[str]:
    return {h.strip() for h in settings.TURNSTILE_HOSTNAMES.split(",") if h.strip()}


async def verify_turnstile(token: str, expected_action: str) -> bool:
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
