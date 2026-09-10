"""Security utilities: Argon2id hashing, TOTP 2FA, backup codes."""

import base64
import hashlib

"""Security utilities: Argon2id hashing, TOTP 2FA, backup codes, token blacklist."""

import base64
import io
import json
import secrets
import string

from datetime import datetime, timezone

import pyotp
import qrcode
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id as Argon2idKDF

from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.argon2 import Argon2id as Argon2idKDF
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

from shared.config import settings

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
        salt=salt,
        length=32,
        iterations=3,
        lanes=4,
        memory_cost=65536,
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



# ── Master-key TOTP encryption (not password-dependent) ──

_TOTP_MASTER_KEY = settings.TOTP_MASTER_KEY
if not _TOTP_MASTER_KEY:
    import logging

    # Auto-generate and persist to .env
    _TOTP_MASTER_KEY = secrets.token_urlsafe(32)
    try:
        from pathlib import Path
        _env_file = Path(__file__).resolve().parent.parent.parent / ".env"
        existing = _env_file.read_text(encoding="utf-8") if _env_file.exists() else ""
        if "TOTP_MASTER_KEY" not in existing:
            with open(_env_file, "a", encoding="utf-8") as f:
                f.write(f"\nTOTP_MASTER_KEY={_TOTP_MASTER_KEY}\n")
            logging.getLogger("nurchat").info("TOTP_MASTER_KEY generated and saved to .env")
    except Exception as e:
        logging.getLogger("nurchat").warning(f"Could not persist TOTP_MASTER_KEY: {e}")

def _get_totp_cipher() -> Fernet:
    master_key = _TOTP_MASTER_KEY or secrets.token_urlsafe(32)
    key_bytes = master_key.encode("utf-8")
    if len(key_bytes) < 32:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"nurchat_totp_salt_v1",
            iterations=100000,
        )
        key_bytes = base64.urlsafe_b64encode(kdf.derive(key_bytes))
    else:
        key_bytes = key_bytes[:32].ljust(32, b"=")
        key_bytes = base64.urlsafe_b64encode(key_bytes)
    return Fernet(key_bytes)


def encrypt_totp_secret(secret: str) -> str:
    """Encrypt TOTP secret with master key (not password-dependent)."""
    fernet = _get_totp_cipher()
    encrypted = fernet.encrypt(secret.encode("utf-8"))
    return base64.b64encode(encrypted).decode("utf-8")


def decrypt_totp_secret(encrypted_secret: str) -> str | None:
    """Decrypt TOTP secret with master key."""
    try:
        fernet = _get_totp_cipher()
        encrypted_bytes = base64.b64decode(encrypted_secret.encode("utf-8"))
        decrypted = fernet.decrypt(encrypted_bytes)
        return decrypted.decode("utf-8")
    except Exception:
        return None


# ── Token blacklist (JWT revocation) ──
# In-memory set backed by persistent DB storage so revocations survive restarts.

_BLACKLIST: set[str] = set()
_blacklist_loaded = False


def _persist_revocation(jti: str, expires_at=None) -> None:
    try:
        from server.core.database import SessionLocal
        from server.core.models import RevokedToken
        db = SessionLocal()
        try:
            if not db.query(RevokedToken).filter(RevokedToken.jti == jti).first():
                db.add(RevokedToken(jti=jti, expires_at=expires_at))
                db.commit()
        finally:
            db.close()
    except Exception:
        # DB unavailable — in-memory revocation still applies for this process
        pass


def _load_persisted_blacklist() -> None:
    global _blacklist_loaded
    if _blacklist_loaded:
        return
    _blacklist_loaded = True
    try:
        from server.core.database import SessionLocal
        from server.core.models import RevokedToken
        db = SessionLocal()
        try:
            now = datetime.now(timezone.utc)
            for row in db.query(RevokedToken.jti).all():
                _BLACKLIST.add(row[0])
            # Purge entries whose tokens have already expired —
            # an expired JWT fails validation anyway, no need to keep it.
            purged = db.query(RevokedToken).filter(
                RevokedToken.expires_at.isnot(None),
                RevokedToken.expires_at < now,
            ).delete(synchronize_session=False)
            if purged:
                db.commit()
                _BLACKLIST.intersection_update({
                    j for (j,) in db.query(RevokedToken.jti).all()
                })
        finally:
            db.close()
    except Exception:
        pass


def revoke_token(jti: str, expires_at=None) -> None:
    _BLACKLIST.add(jti)
    _persist_revocation(jti, expires_at)

def is_token_revoked(jti: str) -> bool:
    if jti in _BLACKLIST:
        return True
    _load_persisted_blacklist()
    return jti in _BLACKLIST
