"""Управление хост-режимом (relay на этом устройстве).

Доступно ТОЛЬКО с loopback и только без прокси-заголовков. Важно: запросы
через cloudflared тоже приходят с 127.0.0.1, но Cloudflare всегда добавляет
X-Forwarded-For — поэтому одного адреса недостаточно.
"""

import secrets
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from shared.config import settings

router = APIRouter(prefix="/api/host", tags=["host"])


class HostConfig(BaseModel):
    invite_only: bool
    invite_code: str | None = None


def _is_local(request: Request) -> bool:
    client = request.client
    host = (client.host if client else "") or ""
    if host not in ("127.0.0.1", "::1", "localhost"):
        return False
    if request.headers.get("x-forwarded-for") or request.headers.get("x-real-ip"):
        return False
    return True


def _require_local(request: Request) -> None:
    # 404, а не 403: не подтверждаем существование админ-эндпоинта снаружи.
    if not _is_local(request):
        raise HTTPException(status_code=404, detail="Not Found")


def _snapshot() -> HostConfig:
    invite_only = settings.REGISTRATION_MODE.strip().lower() == "invite"
    return HostConfig(
        invite_only=invite_only,
        invite_code=settings.REGISTRATION_INVITE_CODE if invite_only else None,
    )


def _persist_env() -> None:
    """Сохранить политику в .env, который читает сервер (cwd/.env)."""
    path = Path.cwd() / ".env"
    try:
        lines: list[str] = []
        if path.exists():
            lines = [
                line
                for line in path.read_text(encoding="utf-8").splitlines()
                if not line.startswith(("REGISTRATION_MODE=", "REGISTRATION_INVITE_CODE="))
            ]
        lines.append(f"REGISTRATION_MODE={settings.REGISTRATION_MODE}")
        lines.append(f"REGISTRATION_INVITE_CODE={settings.REGISTRATION_INVITE_CODE}")
        path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    except OSError:
        # Не роняем запрос: политика уже применена в памяти, .env — best effort.
        pass


@router.get("/config", response_model=HostConfig)
async def get_host_config(request: Request) -> HostConfig:
    _require_local(request)
    return _snapshot()


@router.post("/invite", response_model=HostConfig)
async def enable_invite_only(request: Request) -> HostConfig:
    _require_local(request)
    if not settings.REGISTRATION_INVITE_CODE:
        settings.REGISTRATION_INVITE_CODE = secrets.token_urlsafe(9)
    settings.REGISTRATION_MODE = "invite"
    _persist_env()
    return _snapshot()


@router.post("/open", response_model=HostConfig)
async def disable_invite_only(request: Request) -> HostConfig:
    _require_local(request)
    settings.REGISTRATION_MODE = "open"
    _persist_env()
    return _snapshot()
