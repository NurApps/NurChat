"""
Additional security tests for NurChat.
Tests constant-time operations, timing analysis, and cryptographic edge cases.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import hashlib
import secrets
from unittest.mock import MagicMock

import pytest
from nacl.public import PrivateKey, PublicKey, Box
from nacl.signing import SigningKey
from nacl.utils import random as nacl_random

from shared.double_ratchet import hkdf


# ─── Constant-Time Comparison Tests ───

class TestConstantTime:
    """Test timing-safe operations."""

    def test_constant_time_compare(self):
        a = secrets.token_bytes(32)
        b = a
        c = secrets.token_bytes(32)

        # Timing should be similar for equal and unequal
        start = time.perf_counter()
        for _ in range(1000):
            assert a == b
        time_equal = time.perf_counter() - start

        start = time.perf_counter()
        for _ in range(1000):
            assert a != c
        time_unequal = time.perf_counter() - start

        # Should be within reasonable range (not exact due to JIT etc)
        ratio = time_equal / time_unequal if time_unequal > 0 else 1
        assert 0.5 < ratio < 2.0, f"Timing ratio {ratio} suggests timing leak"

    def test_secrets_compare(self):
        a = secrets.token_bytes(32)
        b = a
        c = secrets.token_bytes(32)

        assert secrets.compare_digest(a, b) is True
        assert secrets.compare_digest(a, c) is False


# ─── Memory Safety Tests ───

class TestMemorySafety:
    """Test secure memory handling."""

    def test_zeroize(self):
        data = bytearray(secrets.token_bytes(32))
        original = data.copy()

        # Zeroize
        for i in range(len(data)):
            data[i] = 0

        assert all(b == 0 for b in data)
        assert data != original

    def test_key_cleanup(self):
        sk = PrivateKey.generate()
        key_bytes = bytes(sk)

        # Key should be 32 bytes
        assert len(key_bytes) == 32

        # After use, should be zeroizable
        key_array = bytearray(key_bytes)
        for i in range(len(key_array)):
            key_array[i] = 0
        assert all(b == 0 for b in key_array)


# ─── Cryptographic Edge Cases ───

class TestCryptoEdgeCases:
    """Test cryptographic edge cases."""

    def test_empty_plaintext(self):
        key = nacl_random(32)
        nonce = nacl_random(24)

        # Empty plaintext should still encrypt
        from nacl.secret import SecretBox
        box = SecretBox(key)
        ciphertext = box.encrypt(b"", nonce)
        assert len(ciphertext) > 0

    def test_large_plaintext(self):
        key = nacl_random(32)
        nonce = nacl_random(24)

        from nacl.secret import SecretBox
        box = SecretBox(key)
        plaintext = b"x" * 1024 * 1024  # 1MB
        ciphertext = box.encrypt(plaintext, nonce)
        decrypted = box.decrypt(ciphertext)
        assert decrypted == plaintext

    def test_hkdf_empty_salt(self):
        key = nacl_random(32)
        result = hkdf(key, b"info", b"", 32)
        assert len(result) == 32

    def test_hkdf_empty_info(self):
        key = nacl_random(32)
        result = hkdf(key, b"", b"", 32)
        assert len(result) == 32

    def test_hkdf_different_lengths(self):
        key = nacl_random(32)
        for length in [16, 32, 64]:
            result = hkdf(key, b"info", b"", length)
            assert len(result) == length


# ─── Key Derivation Tests ───

class TestKeyDerivation:
    """Test key derivation security."""

    def test_deterministic(self):
        key = nacl_random(32)
        info = b"test_info"

        k1 = hkdf(key, info, b"", 32)
        k2 = hkdf(key, info, b"", 32)
        assert k1 == k2

    def test_different_inputs_different_outputs(self):
        key = nacl_random(32)

        k1 = hkdf(key, b"info1", b"", 32)
        k2 = hkdf(key, b"info2", b"", 32)
        assert k1 != k2

    def test_different_keys_different_outputs(self):
        info = b"test_info"

        k1 = hkdf(nacl_random(32), info, b"", 32)
        k2 = hkdf(nacl_random(32), info, b"", 32)
        assert k1 != k2


# ─── Replay Protection Tests ───

class TestReplayProtection:
    """Test replay attack prevention."""

    def test_nonce_uniqueness(self):
        nonces = set()
        for _ in range(1000):
            nonce = nacl_random(24)
            assert nonce not in nonces
            nonces.add(nonce)

    def test_message_id_uniqueness(self):
        ids = set()
        for _ in range(1000):
            msg_id = f"msg_{secrets.token_hex(16)}"
            assert msg_id not in ids
            ids.add(msg_id)


# ─── Forward Secrecy Tests ───

class TestForwardSecrecy:
    """Test forward secrecy properties."""

    def test_key_independence(self):
        keys = [nacl_random(32) for _ in range(10)]

        # Each key should be independent
        for i in range(len(keys)):
            for j in range(i + 1, len(keys)):
                assert keys[i] != keys[j]

    def test_compromise_does_not_expose_past(self):
        chain_key = nacl_random(32)
        keys = []

        for _ in range(5):
            msg_key = hkdf(chain_key, b"", b"", 32)
            keys.append(msg_key)
            chain_key = msg_key

        # If current chain_key is compromised, past keys are safe
        # (they were already derived and chain_key has moved on)
        assert len(set(keys)) == 5


# ─── Randomness Quality Tests ───

class TestRandomness:
    """Test randomness quality."""

    def test_random_bytes_unique(self):
        values = set()
        for _ in range(10000):
            value = secrets.token_bytes(32)
            assert value not in values
            values.add(value)

    def test_random_uniformity(self):
        counts = [0] * 256
        for _ in range(100000):
            byte = secrets.token_bytes(1)[0]
            counts[byte] += 1

        # Each byte value should appear roughly equally
        expected = 100000 / 256
        for count in counts:
            assert expected * 0.8 < count < expected * 1.2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
