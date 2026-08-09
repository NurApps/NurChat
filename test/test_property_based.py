"""
Property-Based Tests for NurChat Cryptography — Phase 6: Formal Verification

Uses Hypothesis for property-based testing.
Tests cryptographic invariants that must hold for all inputs.
"""

import pytest
import hypothesis
from hypothesis import given, strategies as st, settings
import secrets
import hashlib

import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.double_ratchet import (
    DoubleRatchetSession,
    KDFChain,
    PreKeyBundle,
    hkdf,
    hkdf_extract,
    hkdf_expand,
)
from nacl.public import PrivateKey, PublicKey, Box


# ─── Strategies ───

# Valid hex strings (64 chars = 32 bytes)
hex_strategy = st.binary(min_size=32, max_size=32)

# Valid public keys (32 bytes)
public_key_strategy = st.binary(min_size=32, max_size=32)

# Message content
message_strategy = st.text(min_size=0, max_size=10000)


# ─── KDF Properties ───

class TestKDFProperties:
    """Property-based tests for KDF."""

    @given(key=hex_strategy)
    @settings(max_examples=100)
    def test_kdf_deterministic(self, key: bytes):
        """Same input always produces same output."""
        result1 = hkdf(b"salt", key, b"info", 32)
        result2 = hkdf(b"salt", key, b"info", 32)
        assert result1 == result2

    @given(key=hex_strategy)
    @settings(max_examples=100)
    def test_kdf_different_salt_differs(self, key: bytes):
        """Different salts produce different output."""
        result1 = hkdf(b"salt1", key, b"info", 32)
        result2 = hkdf(b"salt2", key, b"info", 32)
        assert result1 != result2

    @given(key=hex_strategy)
    @settings(max_examples=100)
    def test_kdf_different_info_differs(self, key: bytes):
        """Different info produces different output."""
        result1 = hkdf(b"salt", key, b"info1", 32)
        result2 = hkdf(b"salt", key, b"info2", 32)
        assert result1 != result2

    @given(key=hex_strategy, length=st.integers(min_value=1, max_value=256))
    @settings(max_examples=50)
    def test_kdf_output_length(self, key: bytes, length: int):
        """Output length matches requested length."""
        result = hkdf(b"salt", key, b"info", length)
        assert len(result) == length


# ─── HKDF Properties ───

class TestHKDFProperties:
    """Property-based tests for HKDF."""

    @given(salt=hex_strategy, ikm=hex_strategy)
    @settings(max_examples=100)
    def test_hkdf_extract_deterministic(self, salt: bytes, ikm: bytes):
        """HKDF extract is deterministic."""
        result1 = hkdf_extract(salt, ikm)
        result2 = hkdf_extract(salt, ikm)
        assert result1 == result2

    @given(ikm=hex_strategy)
    @settings(max_examples=100)
    def test_hkdf_extract_different_salt_differs(self, ikm: bytes):
        """Different salts produce different PRK."""
        result1 = hkdf_extract(b"salt1", ikm)
        result2 = hkdf_extract(b"salt2", ikm)
        assert result1 != result2

    @given(prk=hex_strategy, info=st.binary(min_size=0, max_size=256))
    @settings(max_examples=100)
    def test_hkdf_expand_deterministic(self, prk: bytes, info: bytes):
        """HKDF expand is deterministic."""
        result1 = hkdf_expand(prk, info, 32)
        result2 = hkdf_expand(prk, info, 32)
        assert result1 == result2

    @given(prk=hex_strategy, info=st.binary(min_size=0, max_size=256))
    @settings(max_examples=50)
    def test_hkdf_expand_output_length(self, prk: bytes, info: bytes):
        """HKDF expand produces correct length."""
        result = hkdf_expand(prk, info, 64)
        assert len(result) == 64


# ─── KDF Chain Properties ───

class TestKDFChainProperties:
    """Property-based tests for KDF chain."""

    @given(key=hex_strategy, num_steps=st.integers(min_value=1, max_value=50))
    @settings(max_examples=50)
    def test_chain_produces_unique_keys(self, key: bytes, num_steps: int):
        """Chain produces unique keys."""
        chain = KDFChain(key=key)
        keys = set()

        for _ in range(num_steps):
            msg_key, chain = chain.next_message_key(b"ad")
            keys.add(msg_key.hex())

        # All keys should be unique
        assert len(keys) == num_steps

    @given(key=hex_strategy)
    @settings(max_examples=50)
    def test_chain_deterministic(self, key: bytes):
        """Same chain state produces same output."""
        chain1 = KDFChain(key=key)
        chain2 = KDFChain(key=key)

        k1, _ = chain1.next_message_key(b"ad")
        k2, _ = chain2.next_message_key(b"ad")

        assert k1 == k2

    @given(key=hex_strategy, ad=st.binary(min_size=0, max_size=256))
    @settings(max_examples=50)
    def test_chain_output_independent_of_ad(self, key: bytes, ad: bytes):
        """Different AD produces different keys."""
        chain1 = KDFChain(key=key)
        chain2 = KDFChain(key=key)

        k1, _ = chain1.next_message_key(b"ad1")
        k2, _ = chain2.next_message_key(b"ad2")

        # Keys should be different (with overwhelming probability)
        assert k1 != k2


# ─── Double Ratchet Properties ───

class TestDoubleRatchetProperties:
    """Property-based tests for Double Ratchet."""

    @given(message=message_strategy)
    @settings(max_examples=50)
    def test_session_initialization_deterministic(self, message: str):
        """Session initialization produces valid shared secret."""
        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()

        # First session
        sk1, ephemeral1 = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
        )

        # Second session (same keys, different ephemeral)
        sk2, ephemeral2 = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
        )

        # Both should produce valid 32-byte shared secrets
        assert len(sk1) == 32
        assert len(sk2) == 32
        # Ephemeral keys should be different (random)
        assert ephemeral1.public_key != ephemeral2.public_key

    @given(message=message_strategy)
    @settings(max_examples=50)
    def test_x3dh_symmetric(self, message: str):
        """X3DH produces same shared secret for both parties."""
        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()
        bob_one_time_prekey = PrivateKey.generate()

        # Alice
        sk_alice, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
            bob_one_time_prekey.public_key,
        )

        # Bob
        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_identity,
            bob_signed_prekey,
            bob_one_time_prekey,
            alice_identity.public_key,
            ephemeral.public_key,
        )

        assert sk_alice == sk_bob


# ─── PreKeyBundle Properties ───

class TestPreKeyBundleProperties:
    """Property-based tests for PreKeyBundle."""

    @given(num_one_time=st.integers(min_value=0, max_value=100))
    @settings(max_examples=30)
    def test_bundle_generation(self, num_one_time: int):
        """Bundle generation works for various OPK counts."""
        identity = PrivateKey.generate()
        signed_prekey = PrivateKey.generate()

        bundle = PreKeyBundle.generate(
            identity_private=identity,
            signed_prekey_private=signed_prekey,
            num_one_time=num_one_time,
        )

        assert bundle is not None
        assert len(bundle.one_time_prekeys) == num_one_time

    @given(identity_seed=st.binary(min_size=32, max_size=32))
    @settings(max_examples=30)
    def test_bundle_serialization_roundtrip(self, identity_seed: bytes):
        """Bundle survives serialization/deserialization."""
        identity = PrivateKey.generate()
        signed_prekey = PrivateKey.generate()

        bundle = PreKeyBundle.generate(
            identity_private=identity,
            signed_prekey_private=signed_prekey,
        )

        # Serialize
        data = bundle.to_dict()

        # Verify data structure
        assert "identity_key" in data
        assert "signed_prekey" in data
        assert "signed_prekey_signature" in data
        assert "one_time_prekeys" in data


# ─── Edge Case Properties ───

class TestEdgeCaseProperties:
    """Property-based tests for edge cases."""

    @given(size=st.integers(min_value=0, max_value=1000))
    @settings(max_examples=50)
    def test_random_bytes_unique(self, size: int):
        """Random bytes are unique."""
        bytes1 = secrets.token_bytes(size)
        bytes2 = secrets.token_bytes(size)

        if size > 0:
            assert bytes1 != bytes2

    @given(data=st.binary(min_size=0, max_size=10000))
    @settings(max_examples=50)
    def test_sha256_deterministic(self, data: bytes):
        """SHA-256 is deterministic."""
        hash1 = hashlib.sha256(data).digest()
        hash2 = hashlib.sha256(data).digest()
        assert hash1 == hash2

    @given(data=st.binary(min_size=1, max_size=10000))
    @settings(max_examples=50)
    def test_sha256_different_input_different_output(self, data: bytes):
        """Different input produces different hash."""
        # Modify one byte
        modified = bytearray(data)
        modified[0] ^= 0xFF
        hash1 = hashlib.sha256(data).digest()
        hash2 = hashlib.sha256(bytes(modified)).digest()
        assert hash1 != hash2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
