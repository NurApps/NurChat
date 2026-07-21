from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends

from server.core.discovery import scan_lan, start_discovery
from server.core.security import verify_token_dependency
from server.utils.logger import logger

router = APIRouter()


@router.get("/lan")
async def discover_lan_peers(
    token: dict = Depends(verify_token_dependency),
):
    """Сканирует LAN на наличие других серверов NurChat через UDP multicast."""
    try:
        peers = await asyncio.wait_for(scan_lan(timeout=3.0), timeout=5.0)
        return {"peers": peers}
    except asyncio.TimeoutError:
        logger.debug("LAN discovery timed out")
        return {"peers": []}
    except Exception as e:
        logger.warning("LAN discovery error: %s", e)
        return {"peers": []}
