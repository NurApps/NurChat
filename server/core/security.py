import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from jose import JWTError, jwt
from nacl import public

from shared.config import settings
from shared.exceptions import AuthenticationError

# Initialize HTTPBearer for token extraction
security_scheme = HTTPBearer()

# JWT настройки
SECRET_KEY = settings.JWT_SECRET_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30  # 30 минут
REFRESH_TOKEN_EXPIRE_DAYS = 7  # 7 дней

class SecurityManager:
    """Менеджер безопасности для аутентификации и шифрования"""

    @staticmethod
    def create_access_token(data: dict, expires_delta: timedelta | None = None):
        """Создание JWT access токена (короткий)"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode.update({"exp": expire, "type": "access"})
        return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

    @staticmethod
    def create_refresh_token(data: dict) -> str:
        """Создание refresh токена (долгий)"""
        to_encode = data.copy()
        expire = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
        to_encode.update({"exp": expire, "type": "refresh"})
        return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

    @staticmethod
    def verify_token(token: str) -> dict:
        """Верификация JWT токена"""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            return payload
        except JWTError:
            raise AuthenticationError("Невалидный токен")

    @staticmethod
    def verify_refresh_token(token: str) -> dict:
        """Верификация refresh токена"""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            if payload.get("type") != "refresh":
                raise AuthenticationError("Неверный тип токена")
            return payload
        except JWTError:
            raise AuthenticationError("Невалидный refresh токен")

    @staticmethod
    def generate_user_id() -> str:
        """Генерация анонимного ID пользователя"""
        return f"user_{secrets.token_hex(16)}"

    @staticmethod
    def generate_chat_id() -> str:
        """Генерация ID чата"""
        return f"chat_{secrets.token_hex(16)}"

    @staticmethod
    def generate_message_id() -> str:
        """Генерация ID сообщения"""
        return f"msg_{secrets.token_hex(16)}"

    @staticmethod
    def generate_file_id() -> str:
        """Генерация ID файла"""
        return f"file_{secrets.token_hex(16)}"

    @staticmethod
    def generate_call_id() -> str:
        """Генерация ID звонка"""
        return f"call_{secrets.token_hex(16)}"

    @staticmethod
    def generate_contact_id() -> str:
        """Генерация ID контакта"""
        return f"contact_{secrets.token_hex(16)}"

    @staticmethod
    def generate_invite_id() -> str:
        """Генерация ID приглашения"""
        return f"invite_{secrets.token_hex(16)}"

class EncryptionManager:
    """Менеджер для end-to-end шифрования"""

    @staticmethod
    def generate_keypair():
        """Генерация пары ключей для пользователя"""
        keypair = public.PrivateKey.generate()
        return {
            'private_key': keypair.encode().hex(),
            'public_key': keypair.public_key.encode().hex()
        }

    @staticmethod
    def encrypt_message(message: str, public_key_hex: str) -> str:
        """Шифрование сообщения публичным ключом получателя"""
        try:
            public_key = public.PublicKey(bytes.fromhex(public_key_hex))
            sealed_box = public.SealedBox(public_key)
            encrypted = sealed_box.encrypt(message.encode())
            return encrypted.hex()
        except Exception as e:
            raise Exception(f"Ошибка шифрования: {e}")

    @staticmethod
    def decrypt_message(encrypted_message_hex: str, private_key_hex: str) -> str:
        """Дешифрование сообщения приватным ключом"""
        try:
            private_key = public.PrivateKey(bytes.fromhex(private_key_hex))
            sealed_box = public.SealedBox(private_key)
            decrypted = sealed_box.decrypt(bytes.fromhex(encrypted_message_hex))
            return decrypted.decode()
        except Exception as e:
            raise Exception(f"Ошибка дешифрования: {e}")

async def verify_token_dependency(credentials: HTTPBearer = Depends(security_scheme)) -> dict:
    """FastAPI dependency to extract and verify JWT token from Authorization header"""
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

# Глобальные экземпляры
security = SecurityManager()
encryption = EncryptionManager()
