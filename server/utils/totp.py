"""
TOTP 2FA Utility Module
Provides functions for generating, verifying, and managing TOTP secrets.
Now uses master key encryption (not password-dependent) and supports backup codes.
"""
import pyotp
import qrcode
import base64
import os
import secrets
import hashlib
import json
from io import BytesIO
from typing import Optional, Tuple, List
from fastapi import HTTPException
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

# Master key for encrypting TOTP secrets (independent of user password)
TOTP_MASTER_KEY = os.getenv("TOTP_MASTER_KEY")

if not TOTP_MASTER_KEY:
    # Generate temporary key for development (WARNING: not for production!)
    TOTP_MASTER_KEY = secrets.token_urlsafe(32)
    print("WARNING: TOTP_MASTER_KEY not set in ENV. Using temporary key.")


def _get_totp_cipher() -> Fernet:
    """Get Fernet cipher using master key."""
    key_bytes = TOTP_MASTER_KEY.encode('utf-8')
    
    # Ensure key is proper length for Fernet (32 bytes, URL-safe base64)
    if len(key_bytes) < 32:
        # Derive key if too short
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=b"nurchat_totp_salt_v1",
            iterations=100000,
        )
        key_bytes = base64.urlsafe_b64encode(kdf.derive(key_bytes))
    else:
        # Pad/truncate to 32 bytes and encode
        key_bytes = key_bytes[:32].ljust(32, b'=')
        key_bytes = base64.urlsafe_b64encode(key_bytes)
    
    return Fernet(key_bytes)


def generate_totp_secret() -> str:
    """
    Generate a new random TOTP secret.
    Returns base32-encoded secret string.
    """
    return pyotp.random_base32()


def get_provisioning_uri(username: str, secret: str, issuer: str = "NurChat") -> str:
    """
    Generate OTPAuth URI for QR code provisioning.
    
    Args:
        username: User's username or email
        secret: TOTP secret (base32)
        issuer: Service name
    
    Returns:
        OTPAuth URI string
    """
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=issuer)


def generate_qr_code_data_uri(provisioning_uri: str) -> str:
    """
    Generate QR code as data URI for frontend display.
    
    Args:
        provisioning_uri: OTPAuth URI
    
    Returns:
        Data URI string (data:image/png;base64,...)
    """
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=2,
    )
    qr.add_data(provisioning_uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Save to BytesIO
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    img_bytes = buffered.getvalue()
    
    # Convert to base64
    img_base64 = base64.b64encode(img_bytes).decode('utf-8')
    
    return f"data:image/png;base64,{img_base64}"


def verify_totp(secret: str, code: str, window: int = 1) -> bool:
    """
    Verify a TOTP code against the secret.
    
    Args:
        secret: TOTP secret (base32)
        code: 6-digit code from authenticator app
        window: Acceptable drift in time steps (default: 1 before/after)
    
    Returns:
        True if code is valid, False otherwise
    """
    try:
        totp = pyotp.TOTP(secret)
        return totp.verify(code, valid_window=window)
    except Exception:
        return False


def encrypt_totp_secret(secret: str) -> str:
    """
    Encrypt TOTP secret before storing in database.
    Uses master key (not password-dependent).
    
    Args:
        secret: Plain TOTP secret
    
    Returns:
        Encrypted secret (base64 encoded)
    """
    fernet = _get_totp_cipher()
    encrypted = fernet.encrypt(secret.encode('utf-8'))
    return base64.b64encode(encrypted).decode('utf-8')


def decrypt_totp_secret(encrypted_secret: str) -> str:
    """
    Decrypt TOTP secret from database.
    Uses master key (not password-dependent).
    
    Args:
        encrypted_secret: Encrypted secret (base64 encoded)
    
    Returns:
        Plain TOTP secret
    """
    fernet = _get_totp_cipher()
    encrypted_bytes = base64.b64decode(encrypted_secret.encode('utf-8'))
    decrypted = fernet.decrypt(encrypted_bytes)
    return decrypted.decode('utf-8')


def generate_backup_codes(count: int = 10) -> List[str]:
    """
    Generate one-time backup codes for account recovery.
    
    Args:
        count: Number of codes to generate (default: 10)
    
    Returns:
        List of backup codes (format: XXXX-XXXX)
    """
    codes = []
    for _ in range(count):
        code = f"{secrets.randbelow(10000):04d}-{secrets.randbelow(10000):04d}"
        codes.append(code)
    return codes


def hash_backup_code(code: str) -> str:
    """
    Hash a backup code for secure storage.
    
    Args:
        code: Plain backup code
    
    Returns:
        SHA256 hash of the code with salt
    """
    salt = os.getenv("BACKUP_CODE_SALT", "nurchat_backup_salt_v1")
    return hashlib.sha256(f"{salt}{code}".encode('utf-8')).hexdigest()


def verify_backup_code(code: str, hashed_codes: List[str]) -> bool:
    """
    Verify a backup code against list of hashed codes.
    
    Args:
        code: Plain backup code to verify
        hashed_codes: List of stored hashed codes
    
    Returns:
        True if code matches any hash, False otherwise
    """
    code_hash = hash_backup_code(code)
    return code_hash in hashed_codes
