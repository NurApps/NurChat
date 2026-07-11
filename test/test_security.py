"""Tests for server/utils/security.py — Argon2id, TOTP 2FA, backup codes."""

import json
import sys
import os
import time

import pyotp
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from server.utils.security import (
    hash_password,
    verify_password,
    needs_rehash,
    encrypt_secret,
    decrypt_secret,
    generate_totp_secret,
    generate_totp_uri,
    generate_qr_code_base64,
    verify_totp,
    generate_backup_codes,
    hash_backup_codes,
    verify_backup_code,
)


# ── Argon2id Hashing ──

class TestArgon2idHashing:
    def test_hash_password_returns_string(self):
        h = hash_password("test_password_123")
        assert isinstance(h, str)
        assert len(h) > 50

    def test_verify_correct_password(self):
        h = hash_password("correct_password")
        assert verify_password("correct_password", h) is True

    def test_verify_wrong_password(self):
        h = hash_password("correct_password")
        assert verify_password("wrong_password", h) is False

    def test_verify_empty_password(self):
        h = hash_password("")
        assert verify_password("", h) is True
        assert verify_password("not_empty", h) is False

    def test_verify_unicode_password(self):
        h = hash_password("пароль_кириллица_123")
        assert verify_password("пароль_кириллица_123", h) is True
        assert verify_password("wrong", h) is False

    def test_verify_emoji_password(self):
        h = hash_password("🔐🔑🛡️")
        assert verify_password("🔐🔑🛡️", h) is True

    def test_different_hashes_for_same_password(self):
        h1 = hash_password("same_password")
        h2 = hash_password("same_password")
        assert h1 != h2

    def test_verify_invalid_hash_returns_false(self):
        assert verify_password("password", "not_a_valid_hash") is False

    def test_needs_rehash_returns_bool(self):
        h = hash_password("test")
        assert isinstance(needs_rehash(h), bool)


# ── Fernet Encryption ──

class TestFernetEncryption:
    def test_encrypt_decrypt_roundtrip(self):
        secret = "JBSWY3DPEHPK3PXP"
        password = "my_secure_password"
        encrypted = encrypt_secret(secret, password)
        decrypted = decrypt_secret(encrypted, password)
        assert decrypted == secret

    def test_decrypt_wrong_password_returns_none(self):
        secret = "JBSWY3DPEHPK3PXP"
        encrypted = encrypt_secret(secret, "correct_password")
        result = decrypt_secret(encrypted, "wrong_password")
        assert result is None

    def test_encrypted_format_contains_colon(self):
        encrypted = encrypt_secret("test", "password")
        assert ":" in encrypted

    def test_encrypted_is_different_each_time(self):
        e1 = encrypt_secret("test", "password")
        e2 = encrypt_secret("test", "password")
        assert e1 != e2  # Different salts

    def test_decrypt_garbage_returns_none(self):
        result = decrypt_secret("garbage_data", "password")
        assert result is None


# ── TOTP ──

class TestTOTP:
    def test_generate_secret_returns_base32(self):
        secret = generate_totp_secret()
        assert isinstance(secret, str)
        assert len(secret) == 32
        # Valid base32 characters
        assert all(c in "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567" for c in secret)

    def test_generate_uri_format(self):
        secret = generate_totp_secret()
        uri = generate_totp_uri(secret, "testuser")
        assert uri.startswith("otpauth://totp/")
        assert "testuser" in uri
        assert "NurChat" in uri

    def test_verify_valid_code(self):
        secret = generate_totp_secret()
        totp = pyotp.TOTP(secret)
        code = totp.now()
        assert verify_totp(secret, code) is True

    def test_verify_invalid_code(self):
        secret = generate_totp_secret()
        assert verify_totp(secret, "000000") is False
        assert verify_totp(secret, "12345") is False

    def test_verify_empty_code(self):
        secret = generate_totp_secret()
        assert verify_totp(secret, "") is False

    def test_qr_code_is_data_uri(self):
        secret = generate_totp_secret()
        uri = generate_totp_uri(secret, "testuser")
        qr = generate_qr_code_base64(uri)
        assert qr.startswith("data:image/png;base64,")
        assert len(qr) > 100

    def test_totp_code_valid_window(self):
        """TOTP code should be valid within ±1 window."""
        secret = generate_totp_secret()
        totp = pyotp.TOTP(secret)
        # Current code
        current = totp.now()
        assert verify_totp(secret, current) is True


# ── Backup Codes ──

class TestBackupCodes:
    def test_generate_returns_list(self):
        codes = generate_backup_codes()
        assert isinstance(codes, list)
        assert len(codes) == 10

    def test_code_format(self):
        codes = generate_backup_codes()
        for code in codes:
            assert len(code) == 9  # XXXX-XXXX
            assert code[4] == "-"
            assert code[:4].isalnum()
            assert code[5:].isalnum()

    def test_all_codes_unique(self):
        codes = generate_backup_codes()
        assert len(set(codes)) == len(codes)

    def test_hash_and_verify_backup_code(self):
        codes = generate_backup_codes()
        hashed = hash_backup_codes(codes)

        # Verify first code
        valid, updated = verify_backup_code(codes[0], hashed)
        assert valid is True

        # Code should be removed from updated list
        updated_codes = json.loads(updated)
        assert codes[0] not in updated_codes
        assert len(updated_codes) == 9

    def test_verify_wrong_backup_code(self):
        codes = generate_backup_codes()
        hashed = hash_backup_codes(codes)
        valid, _ = verify_backup_code("XXXX-XXXX", hashed)
        assert valid is False

    def test_verify_backup_code_not_reusable(self):
        codes = generate_backup_codes()
        hashed = hash_backup_codes(codes)

        # First use succeeds
        valid1, updated = verify_backup_code(codes[0], hashed)
        assert valid1 is True

        # Second use with same code fails (code was removed)
        valid2, _ = verify_backup_code(codes[0], updated)
        assert valid2 is False

    def test_hash_backup_codes_returns_json(self):
        codes = generate_backup_codes()
        hashed = hash_backup_codes(codes)
        parsed = json.loads(hashed)
        assert isinstance(parsed, list)
        assert len(parsed) == 10

    def test_verify_invalid_json_returns_false(self):
        valid, original = verify_backup_code("XXXX-XXXX", "not_json")
        assert valid is False
        assert original == "not_json"

    def test_verify_empty_json_returns_false(self):
        valid, original = verify_backup_code("XXXX-XXXX", "[]")
        assert valid is False
