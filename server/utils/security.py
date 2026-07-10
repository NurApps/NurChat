"""Security utilities: Argon2id hashing, TOTP 2FA, backup codes."""

import base64
import hashlib
import io
import json
import secrets
import string

import pyotp
import qrcode
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id as Argon2idKDF

# ── Argon2id password hashing ──

_ph = PasswordHasher(
    time_cost=3,
    memory_cost=65536,  # 64 MB
    parallelism=4,
    hash_len=32,
    salt_len=16,
)


def hash_password(password: str) -> str:
    """Hash password with Argon2id."""
    return _ph.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify password against Argon2id hash. Returns False on any error."""
    try:
        return _ph.verify(hashed, plain)
    except (VerifyMismatchError, Exception):
        return False


def needs_rehash(hashed: str) -> bool:
    """Check if hash needs rehashing (params changed)."""
    return _ph.check_needs_rehash(hashed)


# ── Fernet encryption for TOTP secret ──

def _derive_fernet_key(password: str, salt: bytes) -> bytes:
    """Derive a Fernet key from password using Argon2id."""
    kdf = Argon2idKDF(
        length=32,
        salt=salt,
        time_cost=3,
        memory_cost=65536,
        parallelism=4,
    )
    key = base64.urlsafe_b64encode(kdf.derive(password.encode()))
    return key


def encrypt_secret(plaintext: str, password: str) -> str:
    """Encrypt a secret with a password-derived key. Returns salt:ciphertext."""
    salt = secrets.token_bytes(16)
    key = _derive_fernet_key(password, salt)
    f = Fernet(key)
    token = f.encrypt(plaintext.encode())
    return f"{salt.hex()}:{token.decode()}"


def decrypt_secret(encrypted: str, password: str) -> str | None:
    """Decrypt a secret. Returns None on failure (wrong password)."""
    try:
        salt_hex, token = encrypted.split(":", 1)
        salt = bytes.fromhex(salt_hex)
        key = _derive_fernet_key(password, salt)
        f = Fernet(key)
        return f.decrypt(token.encode()).decode()
    except Exception:
        return None


# ── TOTP ──

def generate_totp_secret() -> str:
    """Generate a random TOTP secret (base32 encoded)."""
    return pyotp.random_base32(length=32)


def generate_totp_uri(secret: str, username: str, issuer: str = "NurChat") -> str:
    """Generate otpauth:// URI for QR code."""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=issuer)


def generate_qr_code_base64(uri: str) -> str:
    """Generate QR code as base64 data URI."""
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def verify_totp(secret: str, code: str) -> bool:
    """Verify a TOTP code against the secret."""
    try:
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=1)
    except Exception:
        return False


# ── Backup codes ──

_BACKUP_CODE_CHARS = string.ascii_uppercase + string.digits
_BACKUP_CODE_LENGTH = 8
_BACKUP_CODE_COUNT = 10


def generate_backup_codes(count: int = _BACKUP_CODE_COUNT) -> list[str]:
    """Generate plaintext backup codes (e.g. ['A1B2C3D4', ...])."""
    codes = []
    for _ in range(count):
        code = "".join(secrets.choice(_BACKUP_CODE_CHARS) for _ in range(_BACKUP_CODE_LENGTH))
        # Format: XXXX-XXXX for readability
        codes.append(f"{code[:4]}-{code[4:]}")
    return codes


def hash_backup_codes(codes: list[str]) -> str:
    """Hash backup codes with Argon2id. Returns JSON array of hashes."""
    hashed = [_ph.hash(code) for code in codes]
    return json.dumps(hashed)


def verify_backup_code(plain_code: str, hashed_json: str) -> tuple[bool, str]:
    """Verify a backup code against stored hashes.
    Returns (is_valid, updated_json) — updated_json removes the used code.
    """
    try:
        hashes = json.loads(hashed_json)
    except (json.JSONDecodeError, TypeError):
        return False, hashed_json

    for i, h in enumerate(hashes):
        if verify_password(plain_code, h):
            hashes.pop(i)
            return True, json.dumps(hashes)

    return False, hashed_json
