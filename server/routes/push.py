"""Web Push subscription and notification routes."""

import json
import logging
import os
import secrets

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from server.core import models
from server.core.database import get_db
from server.core.security import verify_token_dependency

logger = logging.getLogger("nurchat_push")
router = APIRouter(prefix="/api/push", tags=["push"])

# VAPID key management — stable path so keys survive restarts
_vapid_keys_path = os.path.join(os.getcwd(), "vapid_keys.json")


def _get_or_generate_vapid_keys() -> dict:
    """Load or generate VAPID keypair."""
    if os.path.exists(_vapid_keys_path):
        with open(_vapid_keys_path) as f:
            return json.load(f)

    from py_vapid import Vapid
    vapid = Vapid()
    vapid.generate_keys()
    private_pem = vapid.private_pem()
    public_pem = vapid.public_pem()
    # py_vapid may return bytes or str depending on version — normalize
    if isinstance(private_pem, bytes):
        private_pem = private_pem.decode()
    if isinstance(public_pem, bytes):
        public_pem = public_pem.decode()
    keys = {
        "private_key": private_pem,
        "public_key": public_pem,
    }
    with open(_vapid_keys_path, "w") as f:
        json.dump(keys, f)
    logger.info("VAPID keys generated and saved")
    return keys


def _public_key_to_base64url(public_key) -> str:
    """Convert an EC public key object to base64url (uncompressed point)."""
    import base64

    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    raw = public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _load_vapid() -> "object":
    """Load a Vapid instance from env key or generated key file."""
    from py_vapid import Vapid

    from shared.config import settings
    pem = settings.VAPID_PRIVATE_KEY or _get_or_generate_vapid_keys()["private_key"]
    if isinstance(pem, str):
        pem = pem.encode()
    return Vapid.from_pem(pem)


def get_vapid_public_key() -> str:
    """Get VAPID public key as base64url for the browser."""
    vapid = _load_vapid()
    return _public_key_to_base64url(vapid.public_key)


def _get_vapid_private_key() -> str:
    """Get VAPID private key PEM."""
    from shared.config import settings
    if settings.VAPID_PRIVATE_KEY:
        return settings.VAPID_PRIVATE_KEY
    keys = _get_or_generate_vapid_keys()
    return keys["private_key"]


class PushSubscriptionRequest(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


@router.get("/vapid-public-key")
async def get_vapid_key():
    """Return the VAPID public key for the browser to use in PushManager.subscribe()."""
    return {"public_key": get_vapid_public_key()}


@router.post("/subscribe")
async def subscribe_push(
    body: PushSubscriptionRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Store a push subscription for the authenticated user."""
    user_id = token["sub"]

    existing = db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == user_id,
        models.PushSubscription.endpoint == body.endpoint,
    ).first()

    if existing:
        existing.p256dh = body.p256dh
        existing.auth = body.auth
    else:
        sub = models.PushSubscription(
            id=f"push_{secrets.token_hex(16)}",
            user_id=user_id,
            endpoint=body.endpoint,
            p256dh=body.p256dh,
            auth=body.auth,
        )
        db.add(sub)

    db.commit()
    logger.info(f"Push subscription stored for user {user_id}")
    return {"message": "Subscribed"}


@router.delete("/unsubscribe")
async def unsubscribe_push(
    endpoint: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Remove a push subscription."""
    user_id = token["sub"]
    db.query(models.PushSubscription).filter(
        models.PushSubscription.user_id == user_id,
        models.PushSubscription.endpoint == endpoint,
    ).delete()
    db.commit()
    return {"message": "Unsubscribed"}


def send_push_notification(user_id: str, title: str, body: str, data: dict | None = None):
    """Send Web Push notification to all subscriptions of a user."""
    from pywebpush import WebPushException, webpush

    try:
        from server.core.database import SessionLocal
        db = SessionLocal()
        try:
            subscriptions = db.query(models.PushSubscription).filter(
                models.PushSubscription.user_id == user_id
            ).all()

            if not subscriptions:
                return

            private_key = _get_vapid_private_key()
            vapid_claims = {"sub": f"mailto:{os.getenv('VAPID_CLAIM_EMAIL', 'admin@nurchat.app')}"}

            payload = json.dumps({
                "title": title,
                "body": body,
                "data": data or {},
            })

            dead_subs = []
            for sub in subscriptions:
                try:
                    webpush(
                        subscription_info={
                            "endpoint": sub.endpoint,
                            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                        },
                        data=payload,
                        vapid_private_key=private_key,
                        vapid_claims=vapid_claims,
                        ttl=86400,
                    )
                except WebPushException as e:
                    logger.warning(f"Push failed for {user_id}: {e}")
                    if "404" in str(e) or "410" in str(e):
                        dead_subs.append(sub.id)
                except Exception as e:
                    logger.error(f"Push error for {user_id}: {e}")

            if dead_subs:
                db.query(models.PushSubscription).filter(
                    models.PushSubscription.id.in_(dead_subs)
                ).delete(synchronize_session="fetch")
                db.commit()
        finally:
            db.close()
    except Exception as e:
        logger.error(f"Push notification system error: {e}")
