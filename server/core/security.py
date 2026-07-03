import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer
from jose import JWTError, jwt
from nacl import public
from passlib.context import CryptContext

from shared.config import settings
from shared.exceptions import AuthenticationError

# Initialize HTTPBearer for token extraction
security_scheme = HTTPBearer()

# JWT настройки
SECRET_KEY = settings.ENCRYPTION_KEY
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 дней

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

class SecurityManager:
    """Менеджер безопасности для аутентификации и шифрования"""

    @staticmethod
    def create_access_token(data: dict, expires_delta: timedelta | None = None):
        """Создание JWT токена"""
        to_encode = data.copy()
        if expires_delta:
            expire = datetime.now(timezone.utc) + expires_delta
        else:
            expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)

        to_encode.update({"exp": expire})
        encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        return encoded_jwt

    @staticmethod
    def verify_token(token: str) -> dict:
        """Верификация JWT токена"""
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            return payload
        except JWTError:
            raise AuthenticationError("Невалидный токен")

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
