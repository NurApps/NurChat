# ruff: noqa: F821,F841
"""
Phase 6.2: Integration Security Tests
Tests for the actual Double Ratchet / X3DH implementation in shared.double_ratchet.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestDoubleRatchetIntegration:
    """Integration tests for Double Ratchet protocol."""

    def test_session_initialization(self):
        """Test X3DH key agreement produces identical 32-byte shared secrets."""
        from nacl.public import PrivateKey

        from shared.double_ratchet import DoubleRatchetSession

        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()
        bob_one_time_prekey = PrivateKey.generate()

        sk, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
            bob_one_time_prekey.public_key,
        )

        assert sk is not None
        assert len(sk) == 32

        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_identity,
            bob_signed_prekey,
            bob_one_time_prekey,
            alice_identity.public_key,
            ephemeral.public_key,
        )
        assert sk_bob == sk

    def test_session_initialization_without_one_time(self):
        """X3DH must also work when no one-time pre-key is available."""
        from nacl.public import PrivateKey

        from shared.double_ratchet import DoubleRatchetSession

        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()

        sk, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
            None,
        )
        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_identity,
            bob_signed_prekey,
            None,
            alice_identity.public_key,
            ephemeral.public_key,
        )
        assert sk_bob == sk

    def test_message_exchange(self):
        """Test full message exchange with Double Ratchet."""
        from nacl.public import PrivateKey

        from shared.double_ratchet import DoubleRatchetSession

        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()

        # Alice initiates (X3DH)
        alice = DoubleRatchetSession()
        alice.initialize_as_alice(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
        )

        # Bob responds using the same X3DH inputs.
        # initialize_as_alice stores the ephemeral key in DHs; Bob needs it
        # to derive the matching shared secret.
        bob = DoubleRatchetSession()
        bob.initialize_as_bob(
            bob_identity,
            bob_signed_prekey,
            None,
            alice_identity.public_key,
            alice.DHs.public_key,  # Alice's ephemeral from X3DH
        )

        msg1 = alice.encrypt_message("Hello Bob!")
        decrypted = bob.decrypt_message(msg1)
        assert decrypted == "Hello Bob!"

        msg2 = bob.encrypt_message("Hello Alice!")
        decrypted = alice.decrypt_message(msg2)
        assert decrypted == "Hello Alice!"


class TestKeyRotation:
    """Tests for key rotation security."""

    def test_rotation_invalidates_old_keys(self):
        """Each sent message must advance the sending chain key."""
        from nacl.public import PrivateKey

        from shared.double_ratchet import DoubleRatchetSession

        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()

        session = DoubleRatchetSession()
        session.initialize_as_alice(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
        )

        old_chain_key = session.CKs.key

        session.encrypt_message("message")

        assert session.CKs.key != old_chain_key

    def test_forward_secrecy_after_rotation(self):
        """After a DH ratchet step, previous chain keys are replaced."""
        from nacl.public import PrivateKey

        from shared.double_ratchet import DoubleRatchetSession

        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(
            alice_identity,
            bob_identity.public_key,
            bob_signed_prekey.public_key,
        )
        bob = DoubleRatchetSession()
        bob.initialize_as_bob(
            bob_identity,
            bob_signed_prekey,
            None,
            alice_identity.public_key,
            alice.DHs.public_key,
        )

        first_root_key = alice.RK
        alice.encrypt_message("one")

        # Bob replies -> his side performs DH ratchet; then Alice receives and
        # also ratchets, so her root key must have changed.
        reply = bob.encrypt_message("two")
        alice.decrypt_message(reply)

        assert alice.RK != first_root_key

    def test_multi_message_roundtrip(self):
        """Many messages both ways decrypt correctly with evolving keys."""
        from nacl.public import PrivateKey

        from shared.double_ratchet import DoubleRatchetSession

        alice_identity = PrivateKey.generate()
        bob_identity = PrivateKey.generate()
        bob_signed_prekey = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(
            alice_identity, bob_identity.public_key, bob_signed_prekey.public_key
        )
        bob = DoubleRatchetSession()
        bob.initialize_as_bob(
            bob_identity, bob_signed_prekey, None,
            alice_identity.public_key, alice.DHs.public_key,
        )

        for i in range(10):
            m = alice.encrypt_message(f"a{i}")
            assert bob.decrypt_message(m) == f"a{i}"
            r = bob.encrypt_message(f"b{i}")
            assert alice.decrypt_message(r) == f"b{i}"


class TestPreKeyBundle:
    """Tests for pre-key bundle security."""

    def test_bundle_signature_verification(self):
        """Signed pre-key signature should be verifiable with Ed25519."""
        import nacl.signing
        from nacl.exceptions import BadSignatureError
        from nacl.public import PrivateKey
        from nacl.signing import VerifyKey

        from shared.double_ratchet import PreKeyBundle

        identity_private = PrivateKey.generate()
        signed_prekey_private = PrivateKey.generate()
        # Independent Ed25519 signing key (as in production)
        signing_private = nacl.signing.SigningKey.generate()

        bundle = PreKeyBundle.generate(
            identity_private,
            signed_prekey_private,
            num_one_time=5,
            signing_private=signing_private,
        )

        verify_key = VerifyKey(signing_private.verify_key.encode())
        # Valid signature verifies...
        verify_key.verify(bundle.signed_prekey.encode(), bundle.signed_prekey_signature)

        # ...and tampered pre-key fails verification
        tampered = bytearray(bundle.signed_prekey.encode())
        tampered[0] ^= 0xFF
        with pytest.raises(BadSignatureError):
            verify_key.verify(bytes(tampered), bundle.signed_prekey_signature)

    def test_bundle_with_one_time_prekeys(self):
        """Bundle should include one-time pre-keys."""
        import nacl.signing
        from nacl.public import PrivateKey

        from shared.double_ratchet import PreKeyBundle

        identity_private = PrivateKey.generate()
        signed_prekey_private = PrivateKey.generate()

        bundle = PreKeyBundle.generate(
            identity_private,
            signed_prekey_private,
            num_one_time=10,
            signing_private=nacl.signing.SigningKey.generate(),
        )

        assert len(bundle.one_time_prekeys) == 10


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
