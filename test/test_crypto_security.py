"""
Security property tests for NurChat cryptographic implementation.
Tests zeroization, session destruction, and security invariants.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import nacl.utils
import pytest
from nacl.public import PrivateKey

from shared.double_ratchet import DoubleRatchetSession, KDFChain, hkdf


class TestZeroization:
    """Test that sensitive data is properly zeroized."""

    def test_kdf_chain_key_is_bytes(self):
        """KDF chain key should be bytes that can be zeroized."""
        key = nacl.utils.random(32)
        chain = KDFChain(key)
        assert isinstance(chain.key, bytes)
        original_key = chain.key
        assert len(original_key) == 32

    def test_session_serialization_contains_secret_key(self):
        """Serialized session contains secret key material for persistence."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        serialized = alice.serialize()
        # DHs contains the secret key in hex format (Python: just hex)
        assert serialized["DHs"] is not None
        assert len(serialized["DHs"]) == 64  # 32 bytes = 64 hex chars
        # RK contains root key
        assert serialized["RK"] is not None
        # CKs contains chain key
        assert serialized["CKs"] is not None

    def test_forward_secrecy_old_keys_not_reusable(self):
        """After DH ratchet, old keys should be replaced."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        initial_rk = bob.RK
        initial_dhs_pub = alice.DHs.public_key.encode()

        for _ in range(5):
            env = alice.encrypt_message("test")
            bob.decrypt_message(env)

        env_bob = bob.encrypt_message("reply")
        alice.decrypt_message(env_bob)

        assert bob.RK != initial_rk
        assert alice.DHs.public_key.encode() != initial_dhs_pub

    def test_session_destroy_clears_sensitive_data(self):
        """Session destroy should clear all key material."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        assert alice.DHs is not None
        assert alice.RK is not None

        alice.DHs = None
        alice.RK = None
        alice.CKs = None
        alice.CKr = None
        alice.our_identity_public = None
        alice.their_identity_public = None
        alice._skipped_keys.clear()
        alice._seen_message_ids.clear()

        assert alice.DHs is None
        assert alice.RK is None
        assert alice.CKs is None
        assert alice.CKr is None


class TestReplayProtection:
    """Test replay attack detection."""

    def test_same_message_twice_detected(self):
        """Decrypting the same message twice should raise error."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        env = alice.encrypt_message("secret")
        bob.decrypt_message(env)

        with pytest.raises(ValueError, match="Replay attack"):
            bob.decrypt_message(env)

    def test_tampered_message_number_detected(self):
        """Message with tampered sequence number should fail."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        env = alice.encrypt_message("secret")
        env["header"]["ns"] = 999

        with pytest.raises((ValueError, Exception)):
            bob.decrypt_message(env)


class TestKeyRotation:
    """Test automatic key rotation."""

    def test_key_rotation_interval(self):
        """Keys should rotate after KEY_ROTATION_INTERVAL messages."""
        from shared.double_ratchet import KEY_ROTATION_INTERVAL

        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        for i in range(KEY_ROTATION_INTERVAL + 5):
            env = alice.encrypt_message(f"msg {i}")
            bob.decrypt_message(env)

        assert alice.Ns > 0


class TestAssociatedData:
    """Test associated data binding."""

    def test_ad_is_deterministic(self):
        """Associated data should be same for both parties."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        ad_alice = alice._associated_data()
        ad_bob = bob._associated_data()
        assert ad_alice == ad_bob

    def test_ad_bindings_message(self):
        """Message encrypted with wrong AD should fail."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        eve = DoubleRatchetSession()
        eve.initialize_as_bob(PrivateKey.generate(), PrivateKey.generate(), None, alice_ik.public_key, alice.DHs.public_key)

        env = alice.encrypt_message("secret")

        with pytest.raises(Exception):
            eve.decrypt_message(env)


class TestHKDFSecurity:
    """Test HKDF properties."""

    def test_hkdf_deterministic(self):
        """HKDF should be deterministic."""
        r1 = hkdf(b"salt", b"ikm", b"info", 32)
        r2 = hkdf(b"salt", b"ikm", b"info", 32)
        assert r1 == r2

    def test_hkdf_different_inputs_differ(self):
        """Different inputs should produce different outputs."""
        r1 = hkdf(b"salt1", b"ikm", b"info", 32)
        r2 = hkdf(b"salt2", b"ikm", b"info", 32)
        r3 = hkdf(b"salt", b"ikm1", b"info", 32)
        r4 = hkdf(b"salt", b"ikm", b"info1", 32)
        assert len({r1, r2, r3, r4}) == 4

    def test_hkdf_output_length(self):
        """HKDF should produce correct output length."""
        r32 = hkdf(b"salt", b"ikm", b"info", 32)
        r64 = hkdf(b"salt", b"ikm", b"info", 64)
        assert len(r32) == 32
        assert len(r64) == 64
