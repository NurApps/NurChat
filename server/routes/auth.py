import json as json_lib
import os
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from server.core import models, schemas
from server.core.audit import client_ip, log_audit
from server.core.database import get_db
from server.core.security import security, verify_pending_2fa_dependency, verify_token_dependency
from server.utils.captcha import SIGNUP_ACTION, lockout_manager, verify_turnstile
from server.utils.logger import logger
from server.utils.security import (
    decrypt_totp_secret,
    encrypt_totp_secret,
    generate_backup_codes,
    generate_qr_code_base64,
    generate_totp_secret,
    generate_totp_uri,
    hash_backup_codes,
    remember_tokens_valid_after,
    verify_backup_code,
    verify_totp,
)
from server.utils.security import (
    hash_password as hash_password_argon2,
)
from server.utils.security import (
    verify_password as verify_password_argon2,
)
from shared.config import settings
from shared.exceptions import AuthenticationError
from shared.rate_limiter import limiter

router = APIRouter()


def _lock_ip(request: Request) -> str:
    """IP-ключ для lockout'ов (только in-memory, никуда не пишется).

    client_ip() при LOG_IPS=False возвращает None (deaf relay не хранит IP
    даже в audit-лог) — для lockout-ключа это давало бы один глобальный
    ключ на всех. Здесь IP нужен лишь как ключ счётчика в памяти.
    Оговорка: XFF за недоверенным прокси подделывается — поэтому IP-lockout
    лишь первый рубеж; перебор логина дополнительно душится lockout'ом
    по username (от XFF не зависит) и slowapi-лимитами.
    """
    xff = request.headers.get("X-Forwarded-For")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.get("/captcha")
@limiter.limit("30/minute")
async def get_captcha(request: Request):
    """Sitekey Turnstile этого релея: секрет живёт здесь же, поэтому ключ отдаёт релей, а не сборка."""
    if not settings.TURNSTILE_SITEKEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="CAPTCHA не настроена на сервере"
        )
    return {"provider": "turnstile", "sitekey": settings.TURNSTILE_SITEKEY}


@router.post("/register")
@limiter.limit("5/minute")
async def register(
    request: Request,
    username: str = Body(...),
    password: str = Body(...),
    first_name: str = Body(...),
    last_name: str = Body(default=""),
    turnstile_token: str = Body(...),
    public_key: str = Body(default=""),
    signing_public_key: str = Body(default=""),
    db: Session = Depends(get_db)
):
    """Регистрация пользователя с именем и фамилией"""
    # Капча-спам с одного IP душится lockout'ом (pentest #5).
    reg_lock_key = f"register:{_lock_ip(request)}"
    if lockout_manager.is_locked_out(reg_lock_key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток. Повторите через несколько минут",
        )
    if not await verify_turnstile(turnstile_token, SIGNUP_ACTION):
        lockout_manager.record_failure(reg_lock_key)
        logger.warning(f"Registration: invalid CAPTCHA from {client_ip(request)}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверная CAPTCHA"
        )
    lockout_manager.record_success(reg_lock_key)

    if not first_name or len(first_name.strip()) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Имя должно содержать минимум 2 символа"
        )

    existing_user = db.query(models.User).filter(
        models.User.username == username
    ).first()
    if existing_user:
        logger.warning(f"Registration: username already taken: {username}")
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

    if not public_key or not signing_public_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="public_key и signing_public_key обязательны (генерируются на клиенте)"
        )

    # All validation passed — create user
    try:
        hashed_password = hash_password_argon2(password)
        user_id = security.generate_user_id()
        now = datetime.now(timezone.utc)

        user = models.User(
            id=user_id,
            username=username,
            first_name=first_name.strip(),
            last_name=last_name.strip() if last_name else None,
            hashed_password=hashed_password,
            public_key=public_key,
            signing_public_key=signing_public_key,
            created_at=now,
            last_seen=now,
            is_online=False,
        )

        db.add(user)
        db.commit()
        db.refresh(user)

        logger.info(f"Registration: new user {user.username} (ID: {user.id}) from {client_ip(request)}")
        log_audit(user.id, "user_register", {"username": user.username}, ip_address=client_ip(request))

        access_token = security.create_access_token(
            data={"sub": user.id, "username": user.username}
        )
        refresh_token = security.create_refresh_token(
            data={"sub": user.id, "username": user.username}
        )

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer",
            "user": schemas.UserResponse(
                id=user.id,
                username=user.username,
                first_name=user.first_name,
                last_name=user.last_name,
                created_at=now,
                last_seen=now,
                is_online=False,
                public_key=public_key,
                signing_public_key=signing_public_key,
                avatar_path=None,
                status=None,
                bio=None,
            ),
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration failed for {username}: {e}", exc_info=True)
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
        # Account lockout (pentest #6): перебор пароля к конкретному
        # username за IP-лимитом не спрячешь (атакующий ротирует IP) —
        # после 10 неверных попыток за 15 минут аккаунт молчит 5 минут.
        # Цена: злоумышленник может временно заблокировать чужой логин;
        # порог высокий, ошибка — generic, без подсказок о существовании.
        lock_key = f"login:{user_data.username.strip().lower()}"
        if lockout_manager.is_locked_out(lock_key):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Слишком много попыток. Повторите через несколько минут",
            )
        user = db.query(models.User).filter(
            models.User.username == user_data.username
        ).first()

        if not user:
            logger.warning(f"Login attempt with non-existent username: {user_data.username}")
            lockout_manager.record_failure(lock_key)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные"
            )

        if not verify_password_argon2(user_data.password, user.hashed_password):
            logger.warning(f"Login attempt with wrong password for username: {user_data.username}")
            lockout_manager.record_failure(lock_key)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Неверные учетные данные"
            )

        lockout_manager.record_success(lock_key)

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
# NOTE: sync def — FastAPI выполняет в threadpool (см. chat.py:get_user_chats):
# параллельные запросы к удалённому Supabase, без блокировки event loop с WS.
def get_current_user(
    request: Request,
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
@limiter.limit("5/hour")
async def delete_account(
    request: Request,
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
    request: Request,
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
            # LIKE-wildcards (% _) и бэкслэш экранируем, иначе запрос
            # с % мачит всех пользователей (см. _escape_like в chat.py).
            eq = q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
            query = query.filter(
                models.User.username.ilike(f"%{eq}%", escape="\\") |
                models.User.first_name.ilike(f"%{eq}%", escape="\\")
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
    request: Request,
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Получение пользователя по ID"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return schemas.UserResponse.model_validate(user)


@router.get("/user/{user_id}/identity-keys")
@limiter.limit("10/minute")
# NOTE: sync def — threadpool, см. get_current_user выше.
def get_identity_keys(
    request: Request,
    user_id: str,
    db: Session = Depends(get_db),
    token: dict = Depends(verify_token_dependency)
):
    """Получение публичных identity ключей для Safety Number verification"""
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {
        "user_id": user.id,
        "identity_key": user.signing_public_key or user.public_key,
        "public_key": user.public_key,
    }


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


@router.post("/logout-all")
@limiter.limit("5/minute")
async def logout_all(
    request: Request,
    token: dict = Depends(verify_token_dependency),
    db: Session = Depends(get_db)
):
    """Выход со всех устройств: все выданные ранее access/refresh токены перестают действовать."""
    user_id = token["sub"]
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    cutoff = int(datetime.now(timezone.utc).timestamp())
    user.tokens_valid_after = cutoff
    user.is_online = False
    db.commit()
    remember_tokens_valid_after(user_id, cutoff)

    log_audit(user_id, "user_logout_all", ip_address=client_ip(request))
    return {"message": "Выход выполнен на всех устройствах"}


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
        user_id = token["sub"]
        # sub — claim из серверно-подписанного JWT (generate_user_id выдаёт
        # строго user_<hex32>), но в путь ФС пускаем только этот формат:
        # traversal невозможен даже при странном sub.
        if not re.fullmatch(r"user_[0-9a-f]{32}", user_id):
            raise HTTPException(status_code=401, detail="Недействительный токен")
        user = db.query(models.User).filter(models.User.id == user_id).first()
        if not user:
            raise HTTPException(status_code=404, detail="Пользователь не найден")

        allowed_extensions = {".jpg", ".jpeg", ".png", ".webp"}
        file_extension = os.path.splitext(file.filename)[1].lower() if file.filename else ".jpg"
        if file_extension not in allowed_extensions:
            raise HTTPException(status_code=400, detail="Поддерживаются только jpg, png и webp")

        content = await file.read()
        if len(content) > 5 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Аватар слишком большой. Максимум 5 МБ")

        # Проверяем, что байты — действительно картинка, и нормализуем:
        # разворачиваем по EXIF, счищаем метаданные, ужимаем до 512px.
        # Иначе в static-раздачу ложился бы мусор, который браузеры
        # отказываются рисовать (аватар «загрузился», но не отображается).
        try:
            import io

            from PIL import Image, ImageOps

            with Image.open(io.BytesIO(content)) as probe:
                probe.verify()
            with Image.open(io.BytesIO(content)) as img:
                if getattr(img, "is_animated", False):
                    raise HTTPException(status_code=400, detail="Анимированные изображения не поддерживаются")
                normalized = ImageOps.exif_transpose(img).convert("RGB")
                normalized.thumbnail((512, 512), Image.Resampling.LANCZOS)
                buf = io.BytesIO()
                if file_extension == ".png":
                    normalized.save(buf, format="PNG")
                elif file_extension == ".webp":
                    normalized.save(buf, format="WEBP", quality=85)
                else:
                    file_extension = ".jpg"
                    normalized.save(buf, format="JPEG", quality=85)
                content = buf.getvalue()
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=400, detail="Файл не является изображением")

        avatar_dir = Path("media/avatars") / user_id
        avatar_dir.mkdir(parents=True, exist_ok=True)

        # Чистим весь мусор старых аватаров юзера (не только путь из БД —
        # он мог протухнуть после ручной чистки/миграции).
        # codeql[py/path-injection]: avatar_dir собран из user_id, уже
        # проверенного выше строгим allowlist user_[0-9a-f]{32} (sub из
        # серверно-подписанного JWT) — .., /, \ невозможны; удаление только
        # файлов avatar_* внутри этого каталога.
        for stale in avatar_dir.glob("avatar_*"):
            try:
                if stale.is_file():
                    stale.unlink()
            except OSError as e:
                logger.debug("Could not remove stale avatar: %s", e)

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
                models.Contact.contact_user_id == user.id,
            )
        ).all()

        notified = set()
        for c in contacts:
            peer_id = c.contact_user_id if c.user_id == user.id else c.user_id
            if peer_id not in notified:
                notified.add(peer_id)
                await connection_manager.send_personal_message({
                    "event": "key_changed",
                    "data": {
                        "user_id": user.id,
                        "new_public_key": new_public_key,
                    },
                }, peer_id)
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
@limiter.limit("5/minute")
async def verify_2fa_login_with_token(
    request: Request,
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

