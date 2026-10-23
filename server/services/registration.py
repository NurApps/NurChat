"""Политика регистрации: открытая или по инвайт-коду.

Хост-режим (relay на домашнем устройстве, выставленный в интернет через
туннель) по умолчанию закрывает регистрацию: иначе любой, кто узнал адрес,
создаст себе аккаунт. Код хранится в настройках и переживает рестарт.
"""

import hmac

from shared.config import settings


def invite_required() -> bool:
    return settings.REGISTRATION_MODE.strip().lower() == "invite"


def verify_invite_code(code: str | None) -> bool:
    """Constant-time сравнение. Пустой ожидаемый код = fail-closed."""
    expected = (settings.REGISTRATION_INVITE_CODE or "").strip()
    if not expected:
        return False
    provided = (code or "").strip()
    return hmac.compare_digest(expected.encode(), provided.encode())
