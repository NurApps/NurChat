"""
API routes for Double Ratchet pre-key management.
Handles signed pre-keys, one-time pre-keys, and bundle publishing.
"""

import hashlib

from fastapi import APIRouter, Body, Depends, HTTPException, Request
from nacl.signing import VerifyKey
from sqlalchemy.orm import Session

from server.core import models
from server.core.cache import prekey_cache
from server.core.database import get_db
from server.core.security import verify_token_dependency
from server.utils.logger import logger
from shared.rate_limiter import limiter

router = APIRouter(tags=["keys"])

ONE_TIME_PREKEY_BATCH = 100


def _verify_spk_signature(identity_key_hex: str, spk_hex: str, signature_hex: str) -> bool:
    """Verify Ed25519 signature over SPK public key using identity key."""
    try:
        identity_pub = bytes.fromhex(identity_key_hex)
        spk_pub = bytes.fromhex(spk_hex)
        signature = bytes.fromhex(signature_hex)
        vk = VerifyKey(identity_pub)
        vk.verify(spk_pub, signature)
        return True
    except Exception:
        return False


@router.post("/signed-prekey")
@limiter.limit("10/minute")
async def upload_signed_prekey(
    request: Request,
    public_key: str,
    signature: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Upload signed pre-key (X3DH signed pre-key)."""
    user_id = token["sub"]

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user or not user.public_key:
        raise HTTPException(status_code=400, detail="User has no identity key")

    identity_key = user.signing_public_key or user.public_key
    if not _verify_spk_signature(identity_key, public_key, signature):
        raise HTTPException(status_code=400, detail="Invalid SPK signature")

    old_keys = db.query(models.SignedPreKey).filter(
        models.SignedPreKey.user_id == user_id,
        models.SignedPreKey.is_active,
    ).all()
    for k in old_keys:
        k.is_active = False

    spk = models.SignedPreKey(
        user_id=user_id,
        public_key=public_key,
        signature=signature,
        is_active=True,
    )
    db.add(spk)
    db.commit()

    prekey_cache.invalidate(f"spk:{user_id}")
    prekey_cache.invalidate(f"bundle:{user_id}")

    logger.info(f"Signed pre-key uploaded for user {user_id}")
    return {"status": "ok"}


@router.get("/signed-prekey/{user_id}")
async def get_signed_prekey(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Get active signed pre-key for a user."""
    cache_key = f"spk:{user_id}"
    cached = prekey_cache.get(cache_key)
    if cached is not None:
        return cached

    spk = db.query(models.SignedPreKey).filter(
        models.SignedPreKey.user_id == user_id,
        models.SignedPreKey.is_active,
    ).order_by(models.SignedPreKey.created_at.desc()).first()

    if not spk:
        raise HTTPException(status_code=404, detail="No signed pre-key found")

    result = {
        "public_key": spk.public_key,
        "signature": spk.signature,
    }
    prekey_cache.set(cache_key, result)
    return result


@router.post("/one-time")
@limiter.limit("10/minute")
async def upload_one_time_prekeys(
    request: Request,
    public_keys: list[str] = Body(..., embed=True),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Upload one-time pre-keys (client generates keypairs, uploads only public keys)."""
    user_id = token["sub"]

    if not public_keys or len(public_keys) > ONE_TIME_PREKEY_BATCH:
        raise HTTPException(
            status_code=400,
            detail=f"public_keys must be a list of 1-{ONE_TIME_PREKEY_BATCH} hex strings",
        )

    count = 0
    for pub_hex in public_keys:
        if not pub_hex or not isinstance(pub_hex, str) or len(pub_hex) < 10:
            continue
        otpk = models.OneTimePreKey(user_id=user_id, public_key=pub_hex)
        db.add(otpk)
        count += 1

    db.commit()
    prekey_cache.invalidate(f"bundle:{user_id}")
    logger.info(f"Uploaded {count} one-time pre-keys for user {user_id}")
    return {"count": count}


def _claim_one_time_prekey(db: Session, user_id: str):
    """Atomically claim one unused one-time pre-key for a user.

    Uses an UPDATE ... WHERE NOT is_used so only one concurrent request
    can successfully claim a given key (rowcount check).
    """
    for _attempt in range(3):
        candidate_id = (
            db.query(models.OneTimePreKey.id)
            .filter(
                models.OneTimePreKey.user_id == user_id,
                ~models.OneTimePreKey.is_used,
            )
            .order_by(models.OneTimePreKey.created_at.asc())
            .first()
        )
        if not candidate_id:
            return None

        updated = (
            db.query(models.OneTimePreKey)
            .filter(
                models.OneTimePreKey.id == candidate_id[0],
                ~models.OneTimePreKey.is_used,
            )
            .update({"is_used": True}, synchronize_session=False)
        )
        db.commit()
        if updated:
            return db.get(models.OneTimePreKey, candidate_id[0])
    return None


@router.get("/one-time/{user_id}")
async def get_one_time_prekey(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Get one unused one-time pre-key for a user and mark it as used."""
    otpk = _claim_one_time_prekey(db, user_id)

    if not otpk:
        return {"public_key": None}

    return {"public_key": otpk.public_key}


@router.get("/one-time-count/{user_id}")
async def get_one_time_prekey_count(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Get remaining one-time pre-key count for a user."""
    count = db.query(models.OneTimePreKey).filter(
        models.OneTimePreKey.user_id == user_id,
        ~models.OneTimePreKey.is_used,
    ).count()
    return {"count": count}


@router.get("/bundle/{user_id}")
async def get_prekey_bundle(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """
    Get a pre-key bundle for X3DH session establishment.
    Returns identity key, signed pre-key, and one one-time pre-key.
    """
    cache_key = f"bundle:{user_id}"
    cached = prekey_cache.get(cache_key)
    if cached is not None:
        return cached

    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    spk = db.query(models.SignedPreKey).filter(
        models.SignedPreKey.user_id == user_id,
        models.SignedPreKey.is_active,
    ).order_by(models.SignedPreKey.created_at.desc()).first()

    if not spk:
        raise HTTPException(status_code=404, detail="User has no signed pre-key")

    otpk = _claim_one_time_prekey(db, user_id)

    if otpk:
        prekey_cache.invalidate(cache_key)

    result = {
        "identity_key": user.signing_public_key or user.public_key,
        "signed_prekey": spk.public_key,
        "signed_prekey_signature": spk.signature,
        "one_time_prekey": otpk.public_key if otpk else None,
        "registration_id": int(hashlib.sha256(user.id.encode()).hexdigest()[:6], 16) & 0xFFFFFF,
    }

    if not otpk:
        prekey_cache.set(cache_key, result, ttl=10)

    return result


@router.post("/cleanup")
async def cleanup_used_prekeys(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Delete old used one-time pre-keys."""
    user_id = token["sub"]
    deleted = db.query(models.OneTimePreKey).filter(
        models.OneTimePreKey.user_id == user_id,
        models.OneTimePreKey.is_used,
    ).delete()
    db.commit()
    if deleted:
        logger.info(f"Cleaned up {deleted} used pre-keys for user {user_id}")
    return {"deleted": deleted}
