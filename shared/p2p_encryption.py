import base64
import hashlib

import nacl.public
import nacl.pwhash
import nacl.secret
import nacl.signing
import nacl.utils
from nacl.encoding import HexEncoder
from nacl.public import Box, PrivateKey, PublicKey, SealedBox


class P2PEncryption:
    """
    Гибридное P2P+E2E шифрование для NurChat
    - Сообщения шифруются симметричным ключом чата
    - Ключ чата шифруется публичными ключами участников (P2P)
    - Каждый участник расшифровывает ключ своим приватным ключом
    """

    def __init__(self):
        self.symmetric_key = None
        self.private_key: PrivateKey = None
        self.public_key: PublicKey = None

    def set_asymmetric_keys(self, private_key_hex: str):
        """Установка асимметричных ключей пользователя"""
        self.private_key = PrivateKey(bytes.fromhex(private_key_hex))
        self.public_key = self.private_key.public_key

    def generate_symmetric_key(self) -> bytes:
        """
        Генерирует безопасный симметричный ключ для чата.
        """
        self.symmetric_key = nacl.utils.random(nacl.secret.SecretBox.KEY_SIZE)
        return self.symmetric_key

    def generate_asymmetric_keys(self) -> tuple[bytes, bytes]:
        """
        Генерирует асимметричную пару ключей (приватный и публичный).

        Returns:
            tuple: (private_key, public_key) в hex формате.
        """
        private_key = PrivateKey.generate()
        public_key = private_key.public_key
        return private_key.encode(encoder=HexEncoder), public_key.encode(encoder=HexEncoder)

    def create_shared_key(self, password: str, salt: bytes = None) -> tuple[bytes, bytes]:
        """
        Создает общий ключ из пароля с использованием Scrypt.
        """
        if salt is None:
            salt = nacl.utils.random(nacl.pwhash.scrypt.SALTBYTES)

        password_bytes = password.encode('utf-8')
        key = nacl.pwhash.scrypt.kdf(
            nacl.secret.SecretBox.KEY_SIZE,
            password_bytes,
            salt,
            opslimit=nacl.pwhash.scrypt.OPSLIMIT_INTERACTIVE,
            memlimit=nacl.pwhash.scrypt.MEMLIMIT_INTERACTIVE
        )
        return key, salt

    def encrypt_for_chat(self, data: str, key: bytes) -> str:
        """
        Шифрует данные для чата с использованием симметричного ключа.
        """
        box = nacl.secret.SecretBox(key)
        nonce = nacl.utils.random(nacl.secret.SecretBox.NONCE_SIZE)
        encrypted = box.encrypt(data.encode('utf-8'), nonce)
        return base64.b64encode(encrypted).decode('utf-8')

    def decrypt_for_chat(self, encrypted_data: str, key: bytes) -> str:
        """
        Дешифрует данные из чата с использованием симметричного ключа.
        """
        try:
            box = nacl.secret.SecretBox(key)
            encrypted_str = encrypted_data.strip()
            padding_needed = (4 - len(encrypted_str) % 4) % 4
            encrypted_str += '=' * padding_needed

            encrypted_bytes = base64.b64decode(encrypted_str)
            decrypted = box.decrypt(encrypted_bytes)
            return decrypted.decode('utf-8')
        except Exception as e:
            raise ValueError(f"Decryption failed: {e}")

    def encrypt_session_key_for_participants(self, session_key: bytes,
                                            participant_public_keys: list[str]) -> dict[str, str]:
        """
        Шифрует сессионный ключ чата публичными ключами всех участников.

        Args:
            session_key: Симметричный ключ чата
            participant_public_keys: Список публичных ключей участников (hex)

        Returns:
            Dict: {user_id: encrypted_key_base64}
        """
        encrypted_keys = {}
        for pub_key_hex in participant_public_keys:
            try:
                public_key = PublicKey(pub_key_hex, encoder=HexEncoder)
                sealed_box = SealedBox(public_key)
                encrypted_key = sealed_box.encrypt(session_key)
                encrypted_keys[pub_key_hex] = base64.b64encode(encrypted_key).decode('utf-8')
            except Exception as e:
                raise ValueError(f"Failed to encrypt key for {pub_key_hex}: {e}")
        return encrypted_keys

    def decrypt_session_key(self, encrypted_key_base64: str) -> bytes:
        """
        Расшифровывает сессионный ключ своим приватным ключом.

        Args:
            encrypted_key_base64: Зашифрованный ключ в base64

        Returns:
            bytes: Расшифрованный сессионный ключ
        """
        if self.private_key is None:
            raise ValueError("Private key not set")

        sealed_box = SealedBox(self.private_key)
        encrypted_key_bytes = base64.b64decode(encrypted_key_base64)
        return sealed_box.decrypt(encrypted_key_bytes)

    def encrypt_key_with_public_key(self, key_to_encrypt: bytes, recipient_public_key: bytes) -> str:
        """
        Шифрует ключ с использованием публичного ключа получателя.
        """
        try:
            public_key = PublicKey(recipient_public_key, encoder=HexEncoder)
            sealed_box = SealedBox(public_key)
            encrypted_key = sealed_box.encrypt(key_to_encrypt)
            return base64.b64encode(encrypted_key).decode('utf-8')
        except Exception as e:
            raise ValueError(f"Не удалось зашифровать ключ: {e}")

    def decrypt_key_with_private_key(self, encrypted_key: str, private_key: bytes = None) -> bytes:
        """
        Расшифровывает ключ с использованием приватного ключа.
        """
        pk_bytes = private_key if private_key else self.private_key.encode()
        pk = PrivateKey(pk_bytes, encoder=HexEncoder)
        unseal_box = SealedBox(pk)
        encrypted_key_bytes = base64.b64decode(encrypted_key)
        return unseal_box.decrypt(encrypted_key_bytes)

    # ─── E2E: DH Key Agreement ───

    def derive_shared_secret(self, my_private_key_hex: str, their_public_key_hex: str) -> bytes:
        """
        X25519 DH: derive shared_secret = my_private * their_public
        Returns 32-byte shared secret.
        """
        my_private = PrivateKey(bytes.fromhex(my_private_key_hex))
        their_public = PublicKey(bytes.fromhex(their_public_key_hex))
        box = Box(my_private, their_public)
        return box.shared_key()

    def derive_chat_key(self, my_private_key_hex: str, their_public_key_hex: str, chat_id: str) -> bytes:
        """
        Derive a 32-byte symmetric key from DH shared secret + chat_id context.
        Uses blake2b for domain separation.
        """
        shared_secret = self.derive_shared_secret(my_private_key_hex, their_public_key_hex)
        return hashlib.blake2b(
            shared_secret + chat_id.encode("utf-8"),
            digest_size=nacl.secret.SecretBox.KEY_SIZE,
        ).digest()

    # ─── E2E: Ed25519 Signing ───

    @staticmethod
    def generate_signing_keys() -> tuple[str, str]:
        """Generate Ed25519 signing keypair. Returns (private_hex, public_hex)."""
        sk = nacl.signing.SigningKey.generate()
        vk = sk.verify_key
        return (
            sk.encode(encoder=HexEncoder).decode(),
            vk.encode(encoder=HexEncoder).decode(),
        )

    @staticmethod
    def sign_message(content: str, signing_private_hex: str) -> str:
        """Sign plaintext content with Ed25519. Returns base64 signature."""
        sk = nacl.signing.SigningKey(bytes.fromhex(signing_private_hex))
        signed = sk.sign(content.encode("utf-8"))
        return base64.b64encode(signed.signature).decode("utf-8")

    @staticmethod
    def verify_signature(content: str, signature_b64: str, signing_public_hex: str) -> bool:
        """Verify Ed25519 signature. Returns True if valid."""
        try:
            vk = nacl.signing.VerifyKey(bytes.fromhex(signing_public_hex))
            sig_bytes = base64.b64decode(signature_b64)
            vk.verify(content.encode("utf-8"), sig_bytes)
            return True
        except Exception:
            return False

    # ─── E2E: Group Key ───

    @staticmethod
    def generate_group_key() -> bytes:
        """Random 32-byte symmetric key for group chat."""
        return nacl.utils.random(nacl.secret.SecretBox.KEY_SIZE)

