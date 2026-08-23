import hashlib
import hmac
import ipaddress
import json
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from server.core import models
from server.utils.logger import logger

WEBHOOK_TIMEOUT = 10
WEBHOOK_MAX_RETRIES = 3


def _validate_delivery_target(url: str) -> None:
    """Re-validate the URL at delivery time to mitigate DNS rebinding.

    Creation-time validation alone is not enough: an attacker can register
    a domain, pass validation, then flip its A record to an internal address.
    """
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if parsed.scheme not in ("http", "https"):
        raise ValueError("scheme must be http/https")
    if host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
        raise ValueError("local hosts are not allowed")
    import socket
    for info in socket.getaddrinfo(host, None):
        ip = ipaddress.ip_address(info[4][0])
        if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
            raise ValueError(f"resolves to forbidden address {ip}")


def sign_payload(secret: str, payload: bytes) -> str:
    return hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()


async def fire_webhooks(db: Session, user_id: str, event: str, data: dict[str, Any]) -> None:
    webhooks = db.query(models.Webhook).filter(
        models.Webhook.user_id == user_id,
        models.Webhook.is_active,
    ).all()
    for w in webhooks:
        events = w.events.split(",") if w.events else []
        if event not in events:
            continue
        await deliver_webhook(w, event, data)


async def deliver_webhook(webhook: Any, event: str, data: dict[str, Any]) -> bool:
    # Re-validate at delivery time (DNS rebinding mitigation).
    # Run DNS resolution in a thread so the event loop isn't blocked.
    import asyncio
    try:
        await asyncio.get_running_loop().run_in_executor(
            None, _validate_delivery_target, webhook.url
        )
    except ValueError as e:
        logger.warning(f"[Webhook] blocked delivery to {webhook.url}: {e}")
        return False
    except Exception as e:
        logger.warning(f"[Webhook] target validation failed for {webhook.url}: {e}")
        return False

    payload = json.dumps({
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }).encode()

    headers = {
        "Content-Type": "application/json",
        "User-Agent": "NurChat-Webhook/1.0",
    }
    if webhook.secret:
        headers["X-NurChat-Signature-256"] = sign_payload(webhook.secret, payload)

    for attempt in range(WEBHOOK_MAX_RETRIES):
        try:
            async with httpx.AsyncClient(timeout=WEBHOOK_TIMEOUT) as client:
                res = await client.post(webhook.url, content=payload, headers=headers)
                if res.is_success:
                    logger.info(f"[Webhook] delivered {event} to {webhook.url} (status={res.status_code})")
                    return True
                logger.warning(f"[Webhook] {webhook.url} returned {res.status_code} for {event}, attempt {attempt+1}")
        except httpx.TimeoutException:
            logger.warning(f"[Webhook] timeout for {webhook.url} ({event}), attempt {attempt+1}")
        except httpx.RequestError as e:
            logger.warning(f"[Webhook] error for {webhook.url} ({event}): {e}, attempt {attempt+1}")

    logger.error(f"[Webhook] failed to deliver {event} to {webhook.url} after {WEBHOOK_MAX_RETRIES} attempts")
    return False
