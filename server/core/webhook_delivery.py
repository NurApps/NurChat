import hashlib
import hmac
import json
import sys
from pathlib import Path

if str(Path(__file__).resolve().parent.parent.parent) not in sys.path:
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent))

from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy.orm import Session

from server.core import models
from server.utils.logger import logger

WEBHOOK_TIMEOUT = 10
WEBHOOK_MAX_RETRIES = 3


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
