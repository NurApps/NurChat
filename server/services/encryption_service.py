"""
Серверный сервис для обработки шифрования сообщений
"""
import base64
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from shared.config import ENCRYPTION_KEY

logger = logging.getLogger(__name__)


class ServerEncryptionService:
    """Серверный сервис для обработки шифрования сообщений (AES-256-GCM)"""

    def __init__(self):
        key = ENCRYPTION_KEY[:32].ljust(32, b'\0')
        self.aesgcm = AESGCM(key)

    def encrypt_message_content(self, content: str, chat_id: str) -> str:
        try:
            nonce = os.urandom(12)
            aad = chat_id.encode()
            ciphertext = self.aesgcm.encrypt(nonce, content.encode(), aad)
            full_data = nonce + ciphertext
            return base64.b64encode(full_data).decode()
        except Exception as e:
            logger.error("Error encrypting message: %s", e)
            raise

    def decrypt_message_content(self, encrypted_content: str, chat_id: str) -> str | None:
        try:
            full_data = base64.b64decode(encrypted_content)
            nonce = full_data[:12]
            ciphertext = full_data[12:]
            aad = chat_id.encode()
            plaintext = self.aesgcm.decrypt(nonce, ciphertext, aad)
            return plaintext.decode()
        except Exception as e:
            logger.error("Error decrypting message: %s", e)
            return None

    def encrypt_file_content(self, file_content: bytes, chat_id: str) -> bytes:
        try:
            nonce = os.urandom(12)
            aad = chat_id.encode()
            ciphertext = self.aesgcm.encrypt(nonce, file_content, aad)
            return nonce + ciphertext
        except Exception as e:
            logger.error("Error encrypting file: %s", e)
            raise

    def decrypt_file_content(self, encrypted_file_content: bytes, chat_id: str) -> bytes:
        try:
            nonce = encrypted_file_content[:12]
            ciphertext = encrypted_file_content[12:]
            aad = chat_id.encode()
            return self.aesgcm.decrypt(nonce, ciphertext, aad)
        except Exception as e:
            logger.error("Error decrypting file: %s", e)
            raise
