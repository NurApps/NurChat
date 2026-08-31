import json as json_lib
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.audit import client_ip, log_audit
from server.core.database import get_db
from server.core.security import security, verify_pending_2fa_dependency, verify_token_dependency
from server.utils.captcha import generate_captcha, validate_captcha
from server.utils.logger import logger
from server.utils.security import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_backup_codes,
    generate_qr_code_base64,
    generate_totp_secret,
    generate_totp_uri,
    hash_backup_codes,
    verify_backup_code,
    verify_totp,
)
from server.utils.security import (
    hash_password as hash_password_argon2,
)
from server.utils.security import (
    verify_password as verify_password_argon2,
)
from shared.exceptions import AuthenticationError
from shared.rate_limiter import limiter

router = APIRouter()


@router.get("/captcha")
@limiter.limit("30/minute")
async def get_captcha(request: Request):
    """Get a new CAPTCHA challenge for registration"""
    try:
        captcha_id, question = generate_captcha()
        return {
            "captcha_id": captcha_id,
            "question": question,
        }
    except Exception as e:
        logger.error(f"Get captcha error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Ошибка генерации CAPTCHA"
        )


@router.post("/register")
@limiter.limit("5/minute")
async def register(
    request: Request,
    username: str = Body(...),
    password: str = Body(...),
    first_name: str = Body(...),
    last_name: str = Body(default=""),
    captcha_id: str = Body(...),
    captcha_code: str = Body(...),
    public_key: str = Body(default=""),
    signing_public_key: str = Body(default=""),
    db: Session = Depends(get_db)
):
    """Регистрация пользователя с именем и фамилией"""
    try:
        # Validate CAPTCHA first
        if not validate_captcha(captcha_id, captcha_code):
            logger.warning(f"Registration attempt with invalid CAPTCHA: {captcha_id}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неверная CAPTCHA"
            )

        if not first_name or len(first_name.strip()) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Имя должно содержать минимум 2 символа"
            )

        existing_user = db.query(models.User).filter(
            models.User.username == username
        ).first()
        if existing_user:
            logger.warning(f"Registration attempt with existing username: {username}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username уже занят"
            )

        if len(password) < 8:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пароль должен содержать минимум 8 символов"
            )
        if not re.search(r"[A-Z]", password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пароль должен содержать заглавную латинскую букву"
            )
        if not re.search(r"[a-z]", password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пароль должен содержать строчную латинскую букву"
            )
        if not re.search(r"\d", password) and not any(not c.isascii() for c in password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пароль должен содержать хотя бы одну цифру"
            )

        hashed_password = hash_password_argon2(password)

        # Identity keys MUST be generated client-side: the private key never
        # leaves the user's device (see AGENTS.md / DEVELOPMENT_PLAN.md S3).
        if not public_key or not signing_public_key:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="public_key и signing_public_key обязательны (генерируются на клиенте)"
            )

        user_public_key = public_key
        user_signing_public_key = signing_public_key

        user_id = security.generate_user_id()
        now = datetime.now(timezone.utc)

        user = models.User(
            id=user_id,
            username=username,
            first_name=first_name.strip(),
            last_name=last_name.strip() if last_name else None,
            hashed_password=hashed_password,
            public_key=user_public_key,
            signing_public_key=user_signing_public_key,
            created_at=now,
            last_seen=now,
            is_online=False,
        )

        db.add(user)
        db.commit()
        db.refresh(user)

        logger.info(f"New user registered: {user.username} ({user.first_name} {user.last_name or ''}) (ID: {user.id})")
        log_audit(user.id, "user_register", {"username": user.username}, ip_address=client_ip(request))

        access_token = security.create_access_token(
            data={"sub": user.id, "username": user.username}
        )

        response = schemas.UserResponse(
            id=user.id,
            username=user.username,
            first_name=user.first_name,
            last_name=user.last_name,
            created_at=now,
            last_seen=now,
            is_online=False,
            public_key=user_public_key,
            signing_public_key=user_signing_public_key,
            avatar_path=None,
            status=None,
            bio=None,
        )
        refresh_token = security.create_refresh_token(
            data={"sub": user.id, "username": user.username}
        )
        result = {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": response,
        }
        # NOTE: private keys are NEVER generated or returned by the server.
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )


@router.post("/login", response_model=schemas.Token)
@limiter.limit("5/minute")
async def login(
    request: Request,
    user_data: schemas.UserCreate,
    db: Session = Depends(get_db)
):
    """Вход пользователя с проверкой пароля и 2FA"""
    try:
        user = db.query(models.User).filter(
            models.User.username == user_data.username
        ).first()

        if not user:
            logger.warning(f"Login attempt with non-existent username: {user_data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные"
            )

        if not verify_password_argon2(user_data.password, user.hashed_password):
            logger.warning(f"Login attempt with wrong password for username: {user_data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные"
            )

        if user.is_2fa_enabled:
            access_token = security.create_access_token(
                data={"sub": user.id, "username": user.username, "2fa_pending": True}
            )
            response = schemas.UserResponse(
                id=user.id,
                username=user.username,
                first_name=user.first_name,
                last_name=user.last_name,
                created_at=user.created_at,
                last_seen=user.last_seen,
                is_online=user.is_online,
                public_key=user.public_key,
                signing_public_key=getattr(user, "signing_public_key", None),
                avatar_path=user.avatar_path,
                status=getattr(user, "status", None),
                bio=getattr(user, "bio", None),
            )
            refresh_token = security.create_refresh_token(
                data={"sub": user.id, "username": user.username, "2fa_pending": True}
            )
            return {
                "access_token": access_token,
                "refresh_token": refresh_token,
                "token_type": "bearer",
                "user": response,
                "requires_2fa": True,
            }

        user.last_seen = models.func.now()
        db.commit()

        logger.info(f"User logged in: {user.username} (ID: {user.id})")
        log_audit(user.id, "user_login", ip_address=client_ip(request))

        access_token = security.create_access_token(
            data={"sub": user.id, "username": user.username}
        )

        response = schemas.UserResponse(
            id=user.id,
            username=user.username,
            first_name=user.first_name,
            last_name=user.last_name,
            created_at=user.created_at,
            last_seen=user.last_seen,
            is_online=user.is_online,
            public_key=user.public_key,
            signing_public_key=getattr(user, "signing_public_key", None),
            avatar_path=user.avatar_path,
            status=getattr(user, "status", None),
            bio=getattr(user, "bio", None),
        )
        refresh_token = security.create_refresh_token(
            data={"sub": user.id, "username": user.username}
        )
        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": response
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )


@router.get("/me", response_model=schemas.UserResponse)
@limiter.limit("30/minute")
async def get_current_user(
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db)
):
    """Получение информации о текущем пользователе"""
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            logger.warning(f"User not found for token: {token['sub']}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Пользователь не найден"
            )
        logger.debug(f"User info requested: {user.username} (ID: {user.id})")
        return schemas.UserResponse.model_validate(user)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Get user info error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )


@router.delete("/account")
async def delete_account(
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db)
):
    """Удаление аккаунта пользователя и всех связанных данных (каскадно)."""
    user_id = token["sub"]
    try:
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Пользователь не найден"
            )

        files = db.query(models.File).filter(models.File.user_id == user_id).all()
        try:
            from server.core.storage import file_storage
            for f in files:
                await file_storage.delete_file(f.id, user_id, f.file_path)
        except Exception as e:
            logger.warning(f"Failed to delete files for {user_id}: {e}")

        logger.info(f"Deleting account {user_id} ({user.username})")
        db.delete(user)
        db.commit()
        return {"message": "Аккаунт удален"}
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        logger.error(f"Delete account error: {e}")
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Не удалось удалить аккаунт"
        )


@router.get("/users", response_model=list[schemas.UserResponse])
@limiter.limit("10/minute")
async def get_all_users(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
    q: str = "",
    offset: int = 0,
    limit: int = 50,
):
    """Получение списка пользователей с пагинацией и поиском"""
    try:
        current_user_id = token["sub"]
        query = db.query(models.User).filter(models.User.id != current_user_id)
        if q:
            query = query.filter(
                models.User.username.ilike(f"%{q}%") |
                models.User.first_name.ilike(f"%{q}%")
            )
        users = query.offset(offset).limit(min(limit, 100)).all()
        return [schemas.UserResponse.model_validate(user) for user in users]
    except Exception as e:
        logger.error(f"Get all users error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Внутренняя ошибка сервера"
        )


@router.get("/user/{user_id}", response_model=schemas.UserResponse)
@limiter.limit("30/minute")
async def get_user(
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Получение пользователя по ID"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return schemas.UserResponse.model_validate(user)


@router.post("/logout")
@limiter.limit("10/minute")
async def logout(
    request: Request,
    refresh_token_str: str = Body(None, embed=True),
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db)
):
    """Выход пользователя с отзывом access и refresh токенов"""
    user_id = token["sub"]
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if user:
        user.is_online = False
        db.commit()

    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        security.revoke(auth_header[7:])
    if refresh_token_str:
        security.revoke(refresh_token_str)

    log_audit(user_id, "user_logout", ip_address=client_ip(request))
    return {"message": "Успешный выход"}


@router.post("/profile/update")
async def update_profile(
    username: str = Form(None),
    first_name: str = Form(None),
    last_name: str = Form(None),
    status: str = Form(None),
    bio: str = Form(None),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Обновление профиля пользователя"""
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if username:
            import re
            if not re.match(r"^[a-zA-Z0-9_]+$", username):
                raise HTTPException(status_code=400, detail="Username может содержать только латинские буквы и цифры")
            existing = db.query(models.User).filter(
                models.User.username == username,
                models.User.id != user.id
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="Username уже занят")
            user.username = username

        if first_name is not None:
            if len(first_name.strip()) < 2:
                raise HTTPException(status_code=400, detail="Имя должно содержать минимум 2 символа")
            user.first_name = first_name.strip()

        if last_name is not None:
            user.last_name = last_name.strip() if last_name.strip() else None

        if status is not None:
            user.status = status[:100]

        if bio is not None:
            user.bio = bio[:500]

        db.commit()
        db.refresh(user)

        logger.info(f"Profile updated for user: {user.username}")
        return schemas.UserResponse.model_validate(user)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update profile error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.post("/profile/avatar")
async def upload_avatar(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Загрузка аватара пользователя"""
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        allowed_extensions = {".jpg", ".jpeg", ".png", ".webp"}
        file_extension = os.path.splitext(file.filename)[1].lower() if file.filename else ".jpg"
        if file_extension not in allowed_extensions:
            raise HTTPException(status_code=400, detail="Поддерживаются только jpg, png и webp")

        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Аватар слишком большой. Максимум 5 МБ")

        avatar_dir = Path("media/avatars") / token["sub"]
        avatar_dir.mkdir(parents=True, exist_ok=True)

        if user.avatar_path and os.path.exists(user.avatar_path):
            try:
                os.remove(user.avatar_path)
            except OSError as e:
                logger.debug("Could not remove old avatar: %s", e)

        avatar_path = avatar_dir / f"avatar_{int(datetime.now(timezone.utc).timestamp())}{file_extension}"

        with open(avatar_path, "wb") as f:
            f.write(content)

        avatar_field = str(avatar_path).replace("\\", "/")
        user.avatar_path = avatar_field
        db.commit()
        db.refresh(user)

        logger.info(f"Avatar uploaded for user: {user.username}")
        return schemas.UserResponse.model_validate(user)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload avatar error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.delete("/profile/avatar")
async def delete_avatar(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Удаление аватара пользователя"""
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        if user.avatar_path and os.path.exists(user.avatar_path):
            os.remove(user.avatar_path)

        user.avatar_path = None
        db.commit()

        logger.info(f"Avatar deleted for user: {user.username}")
        return schemas.UserResponse.model_validate(user)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete avatar error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.post("/profile/rotate-key")
async def rotate_key(
    new_public_key: str = Body(..., embed=True),
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Ротация E2E ключа — сохраняет старый ключ в лог, обновляет на новый, уведомляет контакты"""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    old_key = user.public_key

    # Log rotation
    log = models.KeyRotationLog(
        user_id=user.id,
        old_public_key=old_key,
        new_public_key=new_public_key,
    )
    db.add(log)

    user.public_key = new_public_key
    db.commit()

    # Notify all contacts about key change via WebSocket
    try:
        from server.ws.chat_manager import connection_manager
        contacts = db.query(models.Contact).filter(
            or_(
                models.Contact.user_id == user.id,
                models.Contact.contact_id == user.id,
            )
        ).all()

        notified = set()
        for c in contacts:
            peer_id = c.contact_id if c.user_id == user.id else c.user_id
            if peer_id not in notified:
                notified.add(peer_id)
                await connection_manager.send_to_user(peer_id, {
                    "event": "key_changed",
                    "data": {
                        "user_id": user.id,
                        "new_public_key": new_public_key,
                    },
                })
    except Exception:
        pass  # best-effort notification

    return {"status": "ok", "old_key": old_key}


# ── 2FA Endpoints ──

@router.post("/2fa/setup", response_model=schemas.TwoFASetupResponse)
async def setup_2fa(
    body: schemas.TwoFASetupRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Начать настройку 2FA — генерирует секрет, QR-код и backup-коды."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if not verify_password_argon2(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный пароль")

    if user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA уже включена. Сначала отключите.")

    # Generate TOTP secret, encrypted with master key (not password-dependent)
    secret = generate_totp_secret()
    uri = generate_totp_uri(secret, user.username)
    qr_code = generate_qr_code_base64(uri)

    codes = generate_backup_codes()

    user.totp_secret = encrypt_totp_secret(secret)
    user.backup_codes = hash_backup_codes(codes)
    db.commit()

    return schemas.TwoFASetupResponse(
        secret=secret,
        uri=uri,
        qr_code=qr_code,
        backup_codes=codes,
    )


@router.post("/2fa/enable")
async def enable_2fa(
    body: schemas.TwoFAEnableRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Подтвердить TOTP-кодом и включить 2FA."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA уже включена")

    if not user.totp_secret:
        raise HTTPException(status_code=400, detail="Сначала вызовите /2fa/setup")

    if not verify_password_argon2(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный пароль")

    secret = decrypt_totp_secret(user.totp_secret)
    if not secret or not verify_totp(secret, body.code):
        raise HTTPException(status_code=400, detail="Неверный TOTP-код")

    user.is_2fa_enabled = True
    db.commit()

    logger.info(f"2FA enabled for user: {user.username}")
    return {"message": "2FA включена"}


@router.post("/2fa/verify-login")
async def verify_2fa_login_with_token(
    body: schemas.TwoFALoginRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_pending_2fa_dependency),
):
    """Верифицировать 2FA-код при входе (TOTP или backup-код)."""
    if not token.get("2fa_pending"):
        raise HTTPException(status_code=400, detail="Токен не требует 2FA верификации")

    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user or not user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA не активна")

    secret = decrypt_totp_secret(user.totp_secret) if user.totp_secret else None
    totp_valid = secret and verify_totp(secret, body.code)

    # Try backup code
    backup_valid = False
    if not totp_valid and user.backup_codes:
        backup_valid, updated_codes = verify_backup_code(body.code, user.backup_codes)
        if backup_valid:
            user.backup_codes = updated_codes
            db.commit()

    if not totp_valid and not backup_valid:
        logger.warning(f"Failed 2FA attempt for user: {user.username}")
        raise HTTPException(status_code=401, detail="Неверный код")

    # Issue full access token
    user.last_seen = models.func.now()
    db.commit()

    access_token = security.create_access_token(
        data={"sub": user.id, "username": user.username}
    )
    refresh_token = security.create_refresh_token(
        data={"sub": user.id, "username": user.username}
    )

    logger.info(f"User logged in with 2FA: {user.username}")
    return {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "token_type": "bearer",
        "user": schemas.UserResponse.model_validate(user),
    }


@router.post("/2fa/disable")
async def disable_2fa(
    body: schemas.TwoFADisableRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Отключить 2FA (требует пароль + текущий код)."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    if not user.is_2fa_enabled:
        raise HTTPException(status_code=400, detail="2FA не включена")

    if not verify_password_argon2(body.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Неверный пароль")

    secret = decrypt_totp_secret(user.totp_secret) if user.totp_secret else None
    totp_valid = secret and verify_totp(secret, body.code)

    backup_valid = False
    if not totp_valid and user.backup_codes:
        backup_valid, _ = verify_backup_code(body.code, user.backup_codes)

    if not totp_valid and not backup_valid:
        raise HTTPException(status_code=401, detail="Неверный код")

    user.is_2fa_enabled = False
    user.totp_secret = None
    user.backup_codes = None
    db.commit()

    logger.info(f"2FA disabled for user: {user.username}")
    return {"message": "2FA отключена"}


@router.get("/2fa/status", response_model=schemas.TwoFAResponse)
async def get_2fa_status(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency),
):
    """Получить статус 2FA текущего пользователя."""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    remaining = 0
    if user.backup_codes:
        try:
            remaining = len(json_lib.loads(user.backup_codes))
        except Exception as e:
            logger.debug(f"Failed to parse backup codes: {e}")

    return schemas.TwoFAResponse(
        enabled=user.is_2fa_enabled,
        backup_codes_remaining=remaining,
    )


@router.post("/refresh")
@limiter.limit("10/minute")
async def refresh_token(
    request: Request,
    refresh_token_str: str = Body(..., embed=True),
    db: Session = Depends(get_db),
):
    """Обновить access токен по refresh токену."""
    try:
        payload = security.verify_refresh_token(refresh_token_str)
        # 2FA not yet completed — do not issue a full access token
        if payload.get("2fa_pending"):
            raise HTTPException(
                status_code=401,
                detail="Требуется завершить двухфакторную аутентификацию",
            )
        user = db.query(models.User).filter(models.User.id == payload["sub"]).first()
        if not user:
            raise HTTPException(status_code=401, detail="Пользователь не найден")
        new_access = security.create_access_token(
            data={"sub": user.id, "username": user.username}
        )
        new_refresh = security.create_refresh_token(
            data={"sub": user.id, "username": user.username}
        )
        # Rotate refresh token: revoke the old one
        security.revoke(refresh_token_str)
        return {
            "access_token": new_access,
            "refresh_token": new_refresh,
            "token_type": "bearer",
        }
    except AuthenticationError:
        raise HTTPException(status_code=401, detail="Невалидный refresh токен")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Refresh token error: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")

