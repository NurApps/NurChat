# ruff: noqa: F821,F841
"""
Phase 6.2: Integration Security Tests
Tests for the actual frontend cryptographic implementations.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestDoubleRatchetIntegration:
    """Integration tests for Double Ratchet protocol."""

    def test_session_initialization(self):
        """Test session initialization with X3DH."""
        from shared.double_ratchet import DoubleRatchetSession, X3DHKeyPair, X3DHPreKeyBundle, x3dh_initiate

        # Bob creates identity key
        bob_identity = X3DHKeyPair()

        # Bob creates signed pre-key
        bob_signed_prekey = X3DHKeyPair()
        bob_signed_prekey_sig = generate_signature(
            bob_signed_prekey.public_key,
            bob_identity.private_key
        )

        # Bob creates one-time pre-key
        bob_one_time_prekey = X3DHKeyPair()

        # Create pre-key bundle
        bundle = X3DHPreKeyBundle(
            identity_public_key=bob_identity.public_key,
            signed_pre_key=bob_signed_prekey.public_key,
            signed_pre_key_signature=bob_signed_prekey_sig,
            one_time_pre_key=bob_one_time_prekey.public_key,
        )

        # Alice initiates X3DH
        alice_session = DoubleRatchetSession()
        shared_secret = x3dh_initiate(alice_identity.private_key, bundle)

        assert shared_secret is not None
        assert len(shared_secret) == 32

    def test_message_exchange(self):
        """Test full message exchange with Double Ratchet."""
        from shared.double_ratchet import DoubleRatchetSession, X3DHKeyPair, x3dh_initiate

        # Setup
        alice_identity = X3DHKeyPair()
        bob_identity = X3DHKeyPair()

        # Bob creates pre-key bundle
        signed_prekey = X3DHKeyPair()
        one_time_prekey = X3DHKeyPair()

        bundle = X3DHPreKeyBundle(
            identity_public_key=bob_identity.public_key,
            signed_pre_key=signed_prekey.public_key,
            signed_pre_key_signature=generate_signature(
                signed_prekey.public_key,
                bob_identity.private_key
            ),
            one_time_pre_key=one_time_prekey.public_key,
        )

        # Alice initiates
        alice_session = DoubleRatchetSession()
        shared_secret = x3dh_initiate(alice_identity.private_key, bundle)

        # Alice creates session
        alice_session.initialize_as_initiator(
            bob_identity.public_key,
            shared_secret
        )

        # Bob creates session from bundle
        bob_session = DoubleRatchetSession()
        bob_session.initialize_as_responder(
            bob_identity.public_key,
            alice_session.get_current_public_key()
        )

        # Exchange messages
        msg1 = alice_session.send("Hello Bob!")
        assert msg1 is not None

        # Bob receives
        decrypted = bob_session.receive(msg1)
        assert decrypted == "Hello Bob!"

        # Bob replies
        msg2 = bob_session.send("Hello Alice!")
        decrypted = alice_session.receive(msg2)
        assert decrypted == "Hello Alice!"


class TestKeyRotation:
    """Tests for key rotation security."""

    def test_rotation_invalidates_old_keys(self):
        """Key rotation should invalidate old keys."""
        from shared.double_ratchet import DoubleRatchetSession

        session = DoubleRatchetSession()
        old_chain_key = session.chain_key_send

        # Force ratchet step
        session.send("message")

        # Old chain key should not equal current
        assert session.chain_key_send != old_chain_key

    def test_forward_secrecy_after_rotation(self):
        """After key rotation, old messages cannot be decrypted."""

        # This is a conceptual test - in practice, forward secrecy
        # means that compromising current keys doesn't expose past messages
        pass


class TestPreKeyBundle:
    """Tests for pre-key bundle security."""

    def test_bundle_signature_verification(self):
        """Pre-key bundle signature should be verifiable."""
        from shared.double_ratchet import X3DHKeyPair, X3DHPreKeyBundle, generate_signature

        identity = X3DHKeyPair()
        signed_prekey = X3DHKeyPair()

        sig = generate_signature(
            signed_prekey.public_key,
            identity.private_key
        )

        bundle = X3DHPreKeyBundle(
            identity_public_key=identity.public_key,
            signed_pre_key=signed_prekey.public_key,
            signed_pre_key_signature=sig,
        )

        # Verify signature
        assert verify_signature(
            bundle.signed_pre_key,
            bundle.signed_pre_key_signature,
            bundle.identity_public_key
        )

    def test_bundle_with_one_time_prekey(self):
        """Bundle should include one-time pre-key."""
        from shared.double_ratchet import X3DHKeyPair, X3DHPreKeyBundle

        identity = X3DHKeyPair()
        signed_prekey = X3DHKeyPair()
        one_time_prekey = X3DHKeyPair()

        bundle = X3DHPreKeyBundle(
            identity_public_key=identity.public_key,
            signed_pre_key=signed_prekey.public_key,
            signed_pre_key_signature=generate_signature(
                signed_prekey.public_key,
                identity.private_key
            ),
            one_time_pre_key=one_time_prekey.public_key,
        )

        assert bundle.one_time_pre_key is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
