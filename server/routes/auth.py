import os
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy.orm import Session
from server.core import models, schemas
from server.core.database import get_db
from server.core.security import encryption, hash_password, verify_password, security, verify_token_dependency
from server.utils.logger import logger
from shared.rate_limiter import limiter

router = APIRouter()


@router.post("/register")
@limiter.limit("5/minute")
async def register(
    request: Request,
    user_data: schemas.UserCreate,
    db: Session = Depends(get_db)
):
    """Регистрация пользователя с именем и фамилией"""
    try:
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
    db: Session = Depends(get_db)
):
    """Вход пользователя с проверкой пароля"""
    try:
        user = db.query(models.User).filter(
            models.User.username == user_data.username
        ).first()

        if not user:
            logger.warning(f"Login attempt with non-existent username: {user_data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный username"
            )

        if not verify_password(user_data.password, user.hashed_password):
            logger.warning(f"Login attempt with wrong password for username: {user_data.username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверный пароль"
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
