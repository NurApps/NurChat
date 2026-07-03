"""
Серверный сервис для обработки шифрования сообщений
"""
import base64
import os
import logging

from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

from shared.config import ENCRYPTION_KEY

logger = logging.getLogger(__name__)


class ServerEncryptionService:
    """Серверный сервис для обработки шифрования сообщений"""

    def __init__(self):
        self.key = ENCRYPTION_KEY[:32].ljust(32, b'\0')

    def _generate_iv(self) -> bytes:
        """Генерация случайного IV"""
        return os.urandom(16)

    def encrypt_message_content(self, content: str, chat_id: str) -> str:
        """
        Шифрование содержимого сообщения (AES-256-CBC)
        """
        try:
            # Генерируем IV
            iv = self._generate_iv()

            # Создаем шифратор
            cipher = Cipher(
                algorithms.AES(self.key),
                modes.CBC(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()

            # Дополняем сообщение до кратного 16 байт
            padding_length = 16 - (len(content.encode()) % 16)
            padded_content = content.encode() + bytes([padding_length] * padding_length)

            # Шифруем
            encrypted_content = encryptor.update(padded_content) + encryptor.finalize()

            # Возвращаем IV + зашифрованные данные в base64
            full_data = iv + encrypted_content
            return base64.b64encode(full_data).decode()
        except Exception as e:
            logger.error("Error encrypting message: %s", e)
            raise

    def decrypt_message_content(self, encrypted_content: str, chat_id: str) -> str | None:
        """
        Расшифровка содержимого сообщения (AES-256-CBC)
        """
        try:
            # Декодируем base64
            full_data = base64.b64decode(encrypted_content)

            # Извлекаем IV и зашифрованные данные
            iv = full_data[:16]
            ciphertext = full_data[16:]

            # Создаем дешифратор
            cipher = Cipher(
                algorithms.AES(self.key),
                modes.CBC(iv),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()

            # Расшифровываем
            decrypted_content = decryptor.update(ciphertext) + decryptor.finalize()

            # Убираем padding
            padding_length = decrypted_content[-1]
            decrypted_content = decrypted_content[:-padding_length]

            return decrypted_content.decode()
        except Exception as e:
            logger.error("Error decrypting message: %s", e)
            raise

    def encrypt_file_content(self, file_content: bytes, chat_id: str) -> bytes:
        """
        Шифрование содержимого файла (AES-256-CBC)
        """
        try:
            # Генерируем IV
            iv = self._generate_iv()

            # Создаем шифратор
            cipher = Cipher(
                algorithms.AES(self.key),
                modes.CBC(iv),
                backend=default_backend()
            )
            encryptor = cipher.encryptor()

            # Дополняем файл до кратного 16 байт
            padding_length = 16 - (len(file_content) % 16)
            padded_content = file_content + bytes([padding_length] * padding_length)

            # Шифруем
            encrypted_content = encryptor.update(padded_content) + encryptor.finalize()

            # Возвращаем IV + зашифрованные данные
            return iv + encrypted_content
        except Exception as e:
            logger.error("Error encrypting file: %s", e)
            raise

    def decrypt_file_content(self, encrypted_file_content: bytes, chat_id: str) -> bytes:
        """
        Расшифровка содержимого файла (AES-256-CBC)
        """
        try:
            # Извлекаем IV и зашифрованные данные
            iv = encrypted_file_content[:16]
            ciphertext = encrypted_file_content[16:]

            # Создаем дешифратор
            cipher = Cipher(
                algorithms.AES(self.key),
                modes.CBC(iv),
                backend=default_backend()
            )
            decryptor = cipher.decryptor()

            # Расшифровываем
            decrypted_content = decryptor.update(ciphertext) + decryptor.finalize()

            # Убираем padding
            padding_length = decrypted_content[-1]
            decrypted_content = decrypted_content[:-padding_length]

            return decrypted_content
        except Exception as e:
            logger.error("Error decrypting file: %s", e)
            raise
