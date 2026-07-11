import json
import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session
from server.core import models, schemas
from server.core.database import get_db
from server.core.security import encryption, hash_password, verify_password, security, verify_token_dependency, get_encryption_key
from server.utils.captcha import validate_captcha, generate_captcha
from server.utils.totp import (
    generate_totp_secret,
    get_provisioning_uri,
    generate_qr_code_data_uri,
    verify_totp,
    encrypt_totp_secret,
    decrypt_totp_secret,
    generate_backup_codes,
    hash_backup_code,
    verify_backup_code
)
from server.utils.logger import logger
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
    user_data: schemas.UserCreate,
    captcha_id: str = Body(..., embed=True),
    captcha_code: str = Body(..., embed=True),
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
        
        if not user_data.first_name or len(user_data.first_name.strip()) < 2:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Имя должно содержать минимум 2 символа"
            )

        existing_user = db.query(models.User).filter(
            models.User.username == user_data.username
        ).first()
        if existing_user:
            logger.warning(f"Registration attempt with existing username: {user_data.username}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username уже занят"
            )

        password = user_data.password
        has_letters = any(c.isalpha() for c in password)
        is_all_digits = all(c.isdigit() for c in password if c.strip())

        if is_all_digits and len(password) < 4:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Пароль из цифр должен содержать минимум 4 цифры"
            )

        if has_letters:
            latin_letters = [c for c in password if c.isalpha() and c.isascii()]
            if len(latin_letters) < 4:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Если есть латинские буквы, их должно быть минимум 4"
                )

        hashed_password = hash_password(user_data.password)

        keypair = encryption.generate_keypair()

        # Generate Ed25519 signing keys for E2E message verification
        from shared.p2p_encryption import P2PEncryption
        signing_private_hex, signing_public_hex = P2PEncryption.generate_signing_keys()

        user_id = security.generate_user_id()
        now = datetime.now(timezone.utc)

        user = models.User(
            id=user_id,
            username=user_data.username,
            first_name=user_data.first_name.strip(),
            last_name=user_data.last_name.strip() if user_data.last_name else None,
            hashed_password=hashed_password,
            public_key=keypair['public_key'],
            signing_public_key=signing_public_hex,
            created_at=now,
            last_seen=now,
            is_online=False,
        )

        db.add(user)
        db.commit()
        db.refresh(user)

        logger.info(f"New user registered: {user.username} ({user.first_name} {user.last_name or ''}) (ID: {user.id})")

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
            public_key=keypair['public_key'],
            signing_public_key=signing_public_hex,
            avatar_path=None,
            status=None,
            bio=None,
        )
        return {
            "access_token": access_token,
            "token_type": "bearer",
            "user": response,
            "private_key": keypair['private_key'],
            "signing_private_key": signing_private_hex,
        }
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
@limiter.limit("10/minute")
async def login(
    request: Request,
    user_data: schemas.UserCreate,
    totp_code: str = Body(None, embed=True),
    db: Session = Depends(get_db)
):
    """Вход пользователя с проверкой пароля и TOTP (если включен)"""
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

        if not verify_password(user_data.password, user.hashed_password):
            logger.warning(f"Login attempt with wrong password for username: {user_data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные"
            )

        # Check if TOTP is enabled
        if user.totp_enabled and user.totp_secret:
            if not totp_code:
                logger.warning(f"TOTP required for user: {user.username}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="TOTP_REQUIRED",
                    headers={"X-TOTP-Required": "true"}
                )
            
            # Decrypt TOTP secret with master key (not password-dependent)
            secret = decrypt_totp_secret(user.totp_secret)
            
            # Try to verify as TOTP code first
            is_valid = verify_totp(secret, totp_code)
            
            # If not TOTP, try as backup code
            if not is_valid and user.backup_codes:
                hashed_codes = json.loads(user.backup_codes)
                is_valid = verify_backup_code(totp_code, hashed_codes)
                
                # If backup code was used, remove it from the list
                if is_valid:
                    new_hashed_codes = [hc for hc in hashed_codes if hc != hash_backup_code(totp_code)]
                    user.backup_codes = json.dumps(new_hashed_codes) if new_hashed_codes else None
                    db.commit()
            
            if not is_valid:
                logger.warning(f"Invalid TOTP/backup code for user: {user.username}")
                raise HTTPException(
                    status_code=status.HTTP_401_UNAUTHORIZED,
                    detail="Неверный код TOTP или резервный код"
                )

        user.last_seen = models.func.now()
        db.commit()

        logger.info(f"User logged in: {user.username} (ID: {user.id})")

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
        return {
            "access_token": access_token,
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


@router.get("/users", response_model=list[schemas.UserResponse])
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


@router.post("/logout")
async def logout(
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db)
):
    """Выход пользователя"""
    user = db.query(models.User).filter(models.User.id == token["sub"]).first()
    if user:
        user.is_online = False
        db.commit()
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
            if not re.match(r"^[a-zA-Z0-9]+$", username):
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
    """Ротация E2E ключа — сохраняет старый ключ в лог и обновляет на новый"""
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

    return {"status": "ok", "old_key": old_key}


# TOTP 2FA Endpoints
@router.get("/totp/setup")
async def setup_totp(
    request: Request,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """
    Setup TOTP for the current user.
    Returns QR code data URI and secret hint.
    Requires password confirmation.
    """
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        
        # Get password for encryption key derivation
        password = request.headers.get("X-Password-Confirmation")
        if not password:
            raise HTTPException(
                status_code=400, 
                detail="Требуется подтверждение пароля. Передайте в заголовке X-Password-Confirmation"
            )
        
        # Verify password first
        if not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=401, 
                detail="Неверный пароль"
            )
        
        # Generate new TOTP secret (NOT stored yet)
        secret = generate_totp_secret()
        provisioning_uri = get_provisioning_uri(user.username, secret)
        qr_code_uri = generate_qr_code_data_uri(provisioning_uri)
        
        # Return QR code and secret hint (DO NOT store yet - wait for enable)
        secret_hint = secret[:4] + "..." if len(secret) > 4 else secret
        
        return schemas.TOTPSetupResponse(
            qr_code=qr_code_uri,
            secret_hint=secret_hint,
            manual_entry_key=secret  # For manual entry in authenticator app
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TOTP setup error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.post("/totp/enable")
async def enable_totp(
    request: Request,
    totp_data: schemas.TOTPEnableRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """
    Enable TOTP after verifying the first code.
    Requires password confirmation. Generates backup codes.
    """
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        
        # Get password for verification
        password = request.headers.get("X-Password-Confirmation")
        if not password:
            raise HTTPException(
                status_code=400, 
                detail="Требуется подтверждение пароля"
            )
        
        # Verify password
        if not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=401, 
                detail="Неверный пароль"
            )
        
        # Verify the TOTP code provided by user
        # We need to decrypt the secret they just got from /setup
        # But we haven't stored it yet - so we need to pass it in the request
        # Actually, let's change approach: store encrypted secret temporarily
        # Better approach: client sends back the secret they received (encrypted in transit via HTTPS)
        secret = totp_data.secret  # Client sends back the secret from /setup response
        
        if not secret:
            raise HTTPException(
                status_code=400, 
                detail="TOTP секрет обязателен"
            )
        
        # Verify the code works with this secret
        if not verify_totp(secret, totp_data.code):
            raise HTTPException(
                status_code=400, 
                detail="Неверный код TOTP"
            )
        
        # Now encrypt and store
        encrypted_secret = encrypt_totp_secret(secret)
        
        # Generate backup codes
        backup_codes = generate_backup_codes()
        hashed_codes = [hash_backup_code(code) for code in backup_codes]
        
        # Store encrypted secret and backup codes
        user.totp_secret = encrypted_secret
        user.totp_enabled = True
        user.backup_codes = json.dumps(hashed_codes)
        db.commit()
        
        logger.info(f"TOTP enabled for user: {user.username}")
        
        # Return backup codes ONCE (they won't be shown again)
        return {
            "message": "TOTP успешно включен", 
            "enabled": True,
            "backup_codes": backup_codes  # Show these only once!
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TOTP enable error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.post("/totp/disable")
async def disable_totp(
    request: Request,
    totp_data: schemas.TOTPDisableRequest,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """
    Disable TOTP by verifying current code or backup code.
    Requires password confirmation.
    """
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        
        if not user.totp_enabled or not user.totp_secret:
            raise HTTPException(
                status_code=400, 
                detail="TOTP не включен"
            )
        
        # Get password for verification
        password = request.headers.get("X-Password-Confirmation")
        if not password:
            raise HTTPException(
                status_code=400, 
                detail="Требуется подтверждение пароля"
            )
        
        # Verify password
        if not verify_password(password, user.hashed_password):
            raise HTTPException(
                status_code=401, 
                detail="Неверный пароль"
            )
        
        # Decrypt TOTP secret with master key
        secret = decrypt_totp_secret(user.totp_secret)
        
        # Try to verify as TOTP code first
        is_valid = verify_totp(secret, totp_data.code)
        
        # If not TOTP, try as backup code
        if not is_valid and user.backup_codes:
            hashed_codes = json.loads(user.backup_codes)
            is_valid = verify_backup_code(totp_data.code, hashed_codes)
            
            # If backup code was used, remove it from the list
            if is_valid:
                # Remove used code
                new_hashed_codes = [hc for hc in hashed_codes if hc != hash_backup_code(totp_data.code)]
                user.backup_codes = json.dumps(new_hashed_codes) if new_hashed_codes else None
        
        if not is_valid:
            raise HTTPException(
                status_code=400, 
                detail="Неверный код TOTP или резервный код"
            )
        
        user.totp_enabled = False
        user.totp_secret = None
        user.backup_codes = None
        db.commit()
        
        logger.info(f"TOTP disabled for user: {user.username}")
        return {"message": "TOTP успешно отключен", "enabled": False}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TOTP disable error: {e}")
        db.rollback()
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")


@router.get("/totp/status")
async def get_totp_status(
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """
    Get TOTP status for current user.
    """
    try:
        user = db.query(models.User).filter(models.User.id == token["sub"]).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")
        
        return schemas.UserTOTPStatus(
            enabled=user.totp_enabled,
            setup_required=bool(user.totp_secret and not user.totp_enabled)
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TOTP status error: {e}")
        raise HTTPException(status_code=500, detail="Внутренняя ошибка сервера")
