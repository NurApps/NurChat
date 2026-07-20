"""
API routes for Double Ratchet pre-key management.
Handles signed pre-keys, one-time pre-keys, and bundle publishing.
"""

import hashlib
import json
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from nacl.public import PrivateKey, PublicKey
from nacl.encoding import HexEncoder
import nacl.signing

from server.core import models
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from shared.double_ratchet import PreKeyBundle

router = APIRouter(tags=["keys"])

ONE_TIME_PREKEY_BATCH = 100


@router.post("/signed-prekey")
async def upload_signed_prekey(
    public_key: str,
    signature: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Upload signed pre-key (X3DH signed pre-key)."""
    user_id = token["sub"]

    # Deactivate old signed pre-keys
    old_keys = db.query(models.SignedPreKey).filter(
        models.SignedPreKey.user_id == user_id,
        models.SignedPreKey.is_active == True,
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

    logger.info(f"Signed pre-key uploaded for user {user_id}")
    return {"status": "ok"}


@router.get("/signed-prekey/{user_id}")
async def get_signed_prekey(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Get active signed pre-key for a user."""
    spk = db.query(models.SignedPreKey).filter(
        models.SignedPreKey.user_id == user_id,
        models.SignedPreKey.is_active == True,
    ).order_by(models.SignedPreKey.created_at.desc()).first()

    if not spk:
        raise HTTPException(status_code=404, detail="No signed pre-key found")

    return {
        "public_key": spk.public_key,
        "signature": spk.signature,
    }


@router.post("/one-time")
async def upload_one_time_prekeys(
    count: int = ONE_TIME_PREKEY_BATCH,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Generate and upload a batch of one-time pre-keys."""
    user_id = token["sub"]
    keys_data = []

    for _ in range(count):
        kp = PrivateKey.generate()
        pub_hex = kp.public_key.encode(encoder=HexEncoder).decode()
        otpk = models.OneTimePreKey(user_id=user_id, public_key=pub_hex)
        db.add(otpk)
        keys_data.append(pub_hex)

    db.commit()
    logger.info(f"Uploaded {count} one-time pre-keys for user {user_id}")
    return {"count": count, "keys": keys_data}


@router.get("/one-time/{user_id}")
async def get_one_time_prekey(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Get one unused one-time pre-key for a user and mark it as used."""
    otpk = db.query(models.OneTimePreKey).filter(
        models.OneTimePreKey.user_id == user_id,
        models.OneTimePreKey.is_used == False,
    ).order_by(models.OneTimePreKey.created_at.asc()).first()

    if not otpk:
        return {"public_key": None}

    otpk.is_used = True
    db.commit()

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
        models.OneTimePreKey.is_used == False,
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
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    spk = db.query(models.SignedPreKey).filter(
        models.SignedPreKey.user_id == user_id,
        models.SignedPreKey.is_active == True,
    ).order_by(models.SignedPreKey.created_at.desc()).first()

    if not spk:
        raise HTTPException(status_code=404, detail="User has no signed pre-key")

    otpk = db.query(models.OneTimePreKey).filter(
        models.OneTimePreKey.user_id == user_id,
        models.OneTimePreKey.is_used == False,
    ).order_by(models.OneTimePreKey.created_at.asc()).first()

    if otpk:
        otpk.is_used = True
        db.commit()

    return {
        "identity_key": user.public_key,
        "signed_prekey": spk.public_key,
        "signed_prekey_signature": spk.signature,
        "one_time_prekey": otpk.public_key if otpk else None,
        "registration_id": int(hashlib.sha256(user.id.encode()).hexdigest()[:6], 16) & 0xFFFFFF,
    }


@router.post("/cleanup")
async def cleanup_used_prekeys(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Delete old used one-time pre-keys."""
    user_id = token["sub"]
    deleted = db.query(models.OneTimePreKey).filter(
        models.OneTimePreKey.user_id == user_id,
        models.OneTimePreKey.is_used == True,
    ).delete()
    db.commit()
    if deleted:
        logger.info(f"Cleaned up {deleted} used pre-keys for user {user_id}")
    return {"deleted": deleted}
