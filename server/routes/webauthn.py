"""Passkeys (WebAuthn): вход без пароля, второй фактор — сам ключ.

Церемонии по стандарту: сервер отдаёт options+challenge, браузер
отрабатывает с аутентификатором, сервер проверяет подпись. На сервере
только публичные ключи (credential_id + COSE public key + sign_count).

Челленджи — in-memory с TTL 5 мин (как lockout в captcha.py: для
мульти-инстанса нужен Redis, см. USE_REDIS).

Fail-режимы честные:
- verify всегда сверяет origin из allowlist и rp_id, с которым
  регистрировали (rp_id обязан быть суффиксом хоста СТРАНИЦЫ, не релея);
- sign_count обязан расти — застывший счётчик = клон ключа, вход отклоняем.
"""

import base64
import json as json_lib
from datetime import datetime, timedelta, timezone

import webauthn
from fastapi import APIRouter, Body, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from webauthn.helpers.structs import PublicKeyCredentialDescriptor

from server.core import models
from server.core.database import get_db
from server.core.security import security, verify_token_dependency
from server.utils.logger import logger
from server.utils.security import verify_password as verify_password_argon2
from shared.config import settings
from shared.rate_limiter import limiter

router = APIRouter()

CHALLENGE_TTL = timedelta(minutes=5)

# key -> (challenge, rp_id, expires_at). Ключи регистрации привязаны
# к user_id (нужен access-токен), входа — к username (публичный флоу).
_challenges: dict[str, tuple[bytes, str, datetime]] = {}


def _rp_ids() -> list[str]:
    return [h.strip().lower() for h in settings.WEBAUTHN_RP_IDS.split(",") if h.strip()]


def _origins() -> list[str]:
    return [o.strip() for o in settings.WEBAUTHN_ORIGINS.split(",") if o.strip()]


def _host_of_origin(origin: str) -> str:
    """Хост из origin вида scheme://host[:port]. Мусор — пустая строка."""
    try:
        rest = origin.split("://", 1)[1]
    except IndexError:
        return ""
    return rest.split("/", 1)[0].split(":", 1)[0].strip().lower()


def _pick_rp_id(origin: str) -> tuple[str, str]:
    """rp_id обязан быть суффиксом хоста страницы (иначе браузер откажет).

    Возвращает (rp_id, origin). Ошибка — 400 с понятным текстом.
    """
    host = _host_of_origin(origin)
    if not host:
        raise HTTPException(status_code=400, detail="Некорректный origin")
    allowed_ids = _rp_ids()
    allowed_origins = _origins()
    if origin not in allowed_origins:
        raise HTTPException(
            status_code=400,
            detail=f"Origin не разрешён для passkeys: {origin}",
        )
    for rp_id in allowed_ids:
        if host == rp_id or host.endswith(f".{rp_id}"):
            return rp_id, origin
    raise HTTPException(
        status_code=400,
        detail=f"Хост {host} не покрыт WEBAUTHN_RP_IDS",
    )


def _store_challenge(key: str, challenge: bytes, rp_id: str) -> None:
    _challenges[key] = (challenge, rp_id, datetime.now(timezone.utc) + CHALLENGE_TTL)


def _take_challenge(key: str) -> tuple[bytes, str]:
    """Одноразовый забор: повтор_verify тем же challenge невозможен (replay)."""
    item = _challenges.pop(key, None)
    if not item:
        raise HTTPException(status_code=400, detail="Челлендж истёк или уже использован")
    challenge, rp_id, expires = item
    if datetime.now(timezone.utc) > expires:
        raise HTTPException(status_code=400, detail="Челлендж истёк")
    return challenge, rp_id


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _descriptor(credential_id_b64: str) -> PublicKeyCredentialDescriptor:
    padded = credential_id_b64 + "=" * (-len(credential_id_b64) % 4)
    # type по дефолту PUBLIC_KEY-enum (сериализатор берёт .value).
    return PublicKeyCredentialDescriptor(id=base64.urlsafe_b64decode(padded))


def _credential_response(cred: models.WebAuthnCredential) -> dict:
    return {
        "id": cred.id,
        "name": cred.name or "",
        "created_at": cred.created_at.isoformat() if cred.created_at else None,
    }


class OptionsRequest(BaseModel):
    origin: str


class RegisterVerifyRequest(BaseModel):
    credential: dict
    origin: str
    name: str = ""


class LoginOptionsRequest(BaseModel):
    username: str
    origin: str


class LoginVerifyRequest(BaseModel):
    username: str
    credential: dict
    origin: str


class RenameRequest(BaseModel):
    name: str = ""


@router.get("/credentials")
@limiter.limit("30/minute")
async def list_credentials(
    request: Request,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Passkeys текущего пользователя."""
    creds = (
        db.query(models.WebAuthnCredential)
        .filter(models.WebAuthnCredential.user_id == token["sub"])
        .order_by(models.WebAuthnCredential.created_at)
        .all()
    )
    return {"credentials": [_credential_response(c) for c in creds]}


@router.post("/register/options")
@limiter.limit("10/minute")
async def registration_options(
    request: Request,
    body: OptionsRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Начать привязку passkey: исключаем уже привязанные (excludeCredentials)."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    rp_id, _ = _pick_rp_id(body.origin)
    existing = (
        db.query(models.WebAuthnCredential)
        .filter(models.WebAuthnCredential.user_id == user.id)
        .all()
    )
    options = webauthn.generate_registration_options(
        rp_id=rp_id,
        rp_name=settings.WEBAUTHN_RP_NAME,
        user_id=user.id.encode("utf-8")[:64],
        user_name=user.username,
        user_display_name=f"{user.first_name} {user.last_name or ''}".strip() or user.username,
        exclude_credentials=[_descriptor(c.credential_id) for c in existing],
    )
    _store_challenge(f"reg:{user.id}", options.challenge, rp_id)
    return json_lib.loads(webauthn.options_to_json(options))


@router.post("/register/verify")
@limiter.limit("10/minute")
async def registration_verify(
    request: Request,
    body: RegisterVerifyRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Завершить привязку: проверить attestation и сохранить публичный ключ."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    challenge, rp_id = _take_challenge(f"reg:{user.id}")
    try:
        verified = webauthn.verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=body.origin,
        )
    except Exception as e:
        logger.warning(f"WebAuthn register verify failed for {user.username}: {type(e).__name__}")
        raise HTTPException(status_code=400, detail="Passkey не прошёл проверку")
    credential_id = _b64url_nopad(verified.credential_id)
    if db.query(models.WebAuthnCredential).filter(
        models.WebAuthnCredential.credential_id == credential_id
    ).first():
        raise HTTPException(status_code=400, detail="Этот passkey уже привязан")
    cred = models.WebAuthnCredential(
        user_id=user.id,
        credential_id=credential_id,
        public_key=base64.b64encode(verified.credential_public_key).decode(),
        sign_count=verified.sign_count,
        name=(body.name or "").strip()[:64] or None,
        rp_id=rp_id,
    )
    db.add(cred)
    db.commit()
    db.refresh(cred)
    logger.info(f"WebAuthn credential added for {user.username}")
    return {"credential": _credential_response(cred)}


@router.post("/login/options")
@limiter.limit("10/minute")
async def login_options(
    request: Request,
    body: LoginOptionsRequest,
    db: Session = Depends(get_db),
):
    """Начать вход по passkey: allowCredentials = ключи этого username."""
    user = db.query(models.User).filter(models.User.username == body.username.strip()).first()
    # Username не палим: несуществующий — та же 400, что и пустой список.
    # Но options без allowCredentials ушёл бы в userless-флоу, который мы
    # не поддерживаем (нужен sub для сессии) — поэтому 400.
    if not user:
        raise HTTPException(status_code=400, detail="Passkey-вход недоступен")
    creds = (
        db.query(models.WebAuthnCredential)
        .filter(models.WebAuthnCredential.user_id == user.id)
        .all()
    )
    if not creds:
        raise HTTPException(status_code=400, detail="Passkey-вход недоступен")
    rp_id, _ = _pick_rp_id(body.origin)
    options = webauthn.generate_authentication_options(
        rp_id=rp_id,
        allow_credentials=[
            _descriptor(c.credential_id)
            for c in creds
            if c.rp_id == rp_id
        ] or None,
    )
    if not options.allow_credentials:
        raise HTTPException(status_code=400, detail="Passkey-вход недоступен для этого хоста")
    _store_challenge(f"auth:{user.id}", options.challenge, rp_id)
    return json_lib.loads(webauthn.options_to_json(options))


@router.post("/login/verify")
@limiter.limit("5/minute")
async def login_verify(
    request: Request,
    body: LoginVerifyRequest,
    db: Session = Depends(get_db),
):
    """Завершить вход: подпись верна + счётчик вырос → полная сессия.

    Если у пользователя включён TOTP — passkey его НЕ обходит:
    возвращаем 2fa_pending, дальше обычный /2fa/verify-login.
    """
    user = db.query(models.User).filter(models.User.username == body.username.strip()).first()
    if not user:
        raise HTTPException(status_code=401, detail="Неверные учетные данные")
    challenge, rp_id = _take_challenge(f"auth:{user.id}")
    raw_id = (body.credential.get("id") or "") if isinstance(body.credential, dict) else ""
    try:
        padded = raw_id + "=" * (-len(raw_id) % 4)
        raw_bytes = base64.urlsafe_b64decode(padded)
    except Exception:
        raise HTTPException(status_code=400, detail="Некорректный credential")
    cred = db.query(models.WebAuthnCredential).filter(
        models.WebAuthnCredential.user_id == user.id,
        models.WebAuthnCredential.credential_id == _b64url_nopad(raw_bytes),
    ).first()
    if not cred or cred.rp_id != rp_id:
        raise HTTPException(status_code=401, detail="Неверные учетные данные")
    try:
        verified = webauthn.verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=rp_id,
            expected_origin=body.origin,
            credential_public_key=base64.b64decode(cred.public_key),
            credential_current_sign_count=cred.sign_count,
        )
    except Exception as e:
        logger.warning(f"WebAuthn login verify failed for {user.username}: {type(e).__name__}")
        raise HTTPException(status_code=401, detail="Неверные учетные данные")
    if verified.new_sign_count <= cred.sign_count and not (verified.new_sign_count == 0 and cred.sign_count == 0):
        # Клон ключа: счётчик обязан расти (0→0 терпим — часть
        # аутентификаторов не ведёт счётчик вовсе).
        logger.warning(f"WebAuthn sign counter not advancing for {user.username}")
        raise HTTPException(status_code=401, detail="Неверные учетные данные")
    cred.sign_count = verified.new_sign_count
    user.last_seen = models.func.now()
    db.commit()

    if user.is_2fa_enabled:
        pending_access = security.create_access_token(
            data={"sub": user.id, "username": user.username, "2fa_pending": True}
        )
        pending_refresh = security.create_refresh_token(
            data={"sub": user.id, "username": user.username, "2fa_pending": True}
        )
        return {
            "access_token": pending_access,
            "refresh_token": pending_refresh,
            "token_type": "bearer",
            "user": None,
            "requires_2fa": True,
        }

    access_token = security.create_access_token(
        data={"sub": user.id, "username": user.username}
    )
    refresh_token = security.create_refresh_token(
        data={"sub": user.id, "username": user.username}
    )
    from server.core import schemas

    logger.info(f"User logged in with passkey: {user.username}")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": schemas.UserResponse.model_validate(user),
        "requires_2fa": False,
    }


@router.delete("/credentials/{credential_db_id}")
@limiter.limit("10/minute")
async def delete_credential(
    request: Request,
    credential_db_id: int,
    password: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Убрать passkey (с паролем — как отключение 2FA). Последний не трогаем."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if not verify_password_argon2(password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Неверный пароль")
    cred = db.query(models.WebAuthnCredential).filter(
        models.WebAuthnCredential.id == credential_db_id,
        models.WebAuthnCredential.user_id == user.id,
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey не найден")
    db.delete(cred)
    db.commit()
    logger.info(f"WebAuthn credential removed for {user.username}")
    return {"message": "Passkey удалён"}


@router.patch("/credentials/{credential_db_id}")
@limiter.limit("10/minute")
async def rename_credential(
    request: Request,
    credential_db_id: int,
    body: RenameRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Переименовать passkey («Pixel 8», «YubiKey»)."""
    cred = db.query(models.WebAuthnCredential).filter(
        models.WebAuthnCredential.id == credential_db_id,
        models.WebAuthnCredential.user_id == token["sub"],
    ).first()
    if not cred:
        raise HTTPException(status_code=404, detail="Passkey не найден")
    cred.name = (body.name or "").strip()[:64] or None
    db.commit()
    return {"credential": _credential_response(cred)}
