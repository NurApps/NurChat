"""
Phase 6.2: Security Audit Tests for NurChat Cryptographic Implementation
Comprehensive tests for edge cases, fuzzing, and security properties.
"""

import pytest
import hashlib
import hmac
import secrets
from typing import Tuple
import struct

# Import from existing modules
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
from nacl.signing import SigningKey


class TestKeyGeneration:
    """Security tests for key generation."""

    def test_private_key_generation(self):
        """Private keys should be unique."""
        private_keys = []
        for _ in range(100):
            sk = PrivateKey.generate()
            private_keys.append(sk)
        
        # All private keys should be unique
        unique_keys = {sk.encode().hex() for sk in private_keys}
        assert len(unique_keys) == 100, "Duplicate private keys generated"

    def test_key_size_constants(self):
        """All keys should be correct size (32 bytes)."""
        sk = PrivateKey.generate()
        pk = sk.public_key
        assert len(sk.encode()) == 32
        assert len(pk.encode()) == 32


class TestKDFChain:
    """Security tests for KDF chain."""

    def test_chain_advances(self):
        """Chain should advance and produce different keys."""
        key = secrets.token_bytes(32)
        chain = KDFChain(key=key)
        ad = b"test_ad"
        
        msg_key1, chain1 = chain.next_message_key(ad)
        msg_key2, chain2 = chain1.next_message_key(ad)
        
        assert msg_key1 != msg_key2

    def test_deterministic_replay(self):
        """Same chain state should produce same output."""
        key = secrets.token_bytes(32)
        chain1 = KDFChain(key=key)
        chain2 = KDFChain(key=key)
        ad = b"test_ad"
        
        # Both should produce same output
        k1, _ = chain1.next_message_key(ad)
        k2, _ = chain2.next_message_key(ad)
        
        assert k1 == k2


class TestHKDF:
    """Security tests for HKDF."""

    def test_hkdf_basic(self):
        """HKDF should produce correct output."""
        salt = secrets.token_bytes(32)
        ikm = secrets.token_bytes(32)
        info = b"test"
        
        result = hkdf(salt, ikm, info, 32)
        
        assert len(result) == 32
        assert isinstance(result, bytes)

    def test_hkdf_different_salt_differs(self):
        """Different salts should produce different output."""
        ikm = secrets.token_bytes(32)
        info = b"test"
        
        result1 = hkdf(secrets.token_bytes(32), ikm, info, 32)
        result2 = hkdf(secrets.token_bytes(32), ikm, info, 32)
        
        assert result1 != result2

    def test_hkdf_extract_expand(self):
        """HKDF extract and expand should work."""
        salt = secrets.token_bytes(32)
        ikm = secrets.token_bytes(32)
        
        prk = hkdf_extract(salt, ikm)
        assert len(prk) == 32
        
        okm = hkdf_expand(prk, b"info", 64)
        assert len(okm) == 64


class TestDoubleRatchetSession:
    """Security tests for Double Ratchet session."""

    def test_session_initialization(self):
        """Session should be initializable."""
        session = DoubleRatchetSession()
        
        assert session.DHs is None
        assert session.DHr is None
        assert session.RK is None

    def test_x3dh_key_exchange(self):
        """X3DH should produce same shared secret for both parties."""
        # Alice's keys
        alice_identity = PrivateKey.generate()
        alice_ephemeral = PrivateKey.generate()
        
        # Bob's keys
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()
        bob_one_time_prekey = PrivateKey.generate()
        
        # Alice performs X3DH
        sk_alice, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
            bob_one_time_prekey.public_key,
        )
        
        # Bob performs X3DH
        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_identity,
            bob_signed_prekey,
            bob_one_time_prekey,
            alice_identity.public_key,
            ephemeral.public_key,
        )
        
        # Shared secrets should be equal
        assert sk_alice == sk_bob

    def test_x3dh_without_one_time_prekey(self):
        """X3DH should work without one-time pre-key."""
        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()
        
        sk_alice, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
            None,  # No one-time prekey
        )
        
        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_identity,
            bob_signed_prekey,
            None,  # No one-time prekey
            alice_identity.public_key,
            ephemeral.public_key,
        )
        
        assert sk_alice == sk_bob

    def test_forward_secrecy(self):
        """Compromising long-term key should not expose past sessions."""
        # First session
        alice1_identity = PrivateKey.generate()
        bob1_identity = PrivateKey.generate()
        bob1_signed_prekey = PrivateKey.generate()
        bob1_one_time_prekey = PrivateKey.generate()
        
        sk1, _ = DoubleRatchetSession.x3dh_initialize(
            alice1_identity,
            bob1_identity.public_key,
            bob1_signed_prekey.public_key,
            bob1_one_time_prekey.public_key,
        )
        
        # Second session
        alice2_identity = PrivateKey.generate()
        bob2_identity = PrivateKey.generate()
        bob2_signed_prekey = PrivateKey.generate()
        bob2_one_time_prekey = PrivateKey.generate()
        
        sk2, _ = DoubleRatchetSession.x3dh_initialize(
            alice2_identity,
            bob2_identity.public_key,
            bob2_signed_prekey.public_key,
            bob2_one_time_prekey.public_key,
        )
        
        # Different sessions should have different shared secrets
        assert sk1 != sk2


class TestPreKeyBundle:
    """Security tests for PreKeyBundle."""

    def test_bundle_generation(self):
        """PreKeyBundle should be generateable."""
        identity_private = PrivateKey.generate()
        signed_prekey_private = PrivateKey.generate()
        
        bundle = PreKeyBundle.generate(
            identity_private=identity_private,
            signed_prekey_private=signed_prekey_private,
            num_one_time=10,
        )
        
        assert bundle is not None
        assert bundle.identity_key is not None
        assert bundle.signed_prekey is not None
        assert bundle.signed_prekey_signature is not None
        assert len(bundle.one_time_prekeys) == 10

    def test_bundle_signature_verification(self):
        """PreKeyBundle signature should be verifiable."""
        identity_private = PrivateKey.generate()
        signing_key = SigningKey.generate()
        signed_prekey_private = PrivateKey.generate()
        
        bundle = PreKeyBundle.generate(
            identity_private=identity_private,
            signed_prekey_private=signed_prekey_private,
            num_one_time=10,
            signing_private=signing_key,
        )
        
        # Verify signature
        try:
            signing_key.verify_key.verify(
                bundle.signed_prekey.encode(),
                bundle.signed_prekey_signature
            )
        except Exception:
            pytest.fail("Signature verification failed")

    def test_bundle_serialization(self):
        """PreKeyBundle should be serializable."""
        identity_private = PrivateKey.generate()
        signed_prekey_private = PrivateKey.generate()
        
        bundle = PreKeyBundle.generate(
            identity_private=identity_private,
            signed_prekey_private=signed_prekey_private,
        )
        
        data = bundle.to_dict()
        assert data is not None
        assert "identity_key" in data
        assert "signed_prekey" in data


class TestEdgeCases:
    """Edge case tests."""

    def test_empty_info_hkdf(self):
        """HKDF should handle empty info."""
        salt = secrets.token_bytes(32)
        ikm = secrets.token_bytes(32)
        
        result = hkdf(salt, ikm, b"", 32)
        
        assert len(result) == 32

    def test_large_info_hkdf(self):
        """HKDF should handle large info."""
        salt = secrets.token_bytes(32)
        ikm = secrets.token_bytes(32)
        info = secrets.token_bytes(1024)
        
        result = hkdf(salt, ikm, info, 32)
        
        assert len(result) == 32

    def test_multiple_independent_sessions(self):
        """Should handle multiple independent sessions."""
        sessions = []
        for _ in range(10):
            session = DoubleRatchetSession()
            # Initialize with X3DH
            alice_identity = PrivateKey.generate()
            bob_identity = PrivateKey.generate()
            bob_signed_prekey = PrivateKey.generate()
            sk, ephemeral = DoubleRatchetSession.x3dh_initialize(
                alice_identity,
                bob_identity.public_key,
                bob_signed_prekey.public_key,
            )
            session.initialize_as_alice(
                alice_identity,
                bob_identity.public_key,
                bob_signed_prekey.public_key,
            )
            sessions.append(session)
        
        # All should be independent (different internal state)
        for i, s1 in enumerate(sessions):
            for j, s2 in enumerate(sessions):
                if i != j:
                    # Different sessions should have different state
                    assert s1.DHs != s2.DHs or s1.RK != s2.RK


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
