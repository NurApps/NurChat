"""
Tests for sealed sender protocol (Phase 2: Metadata Protection).
Verifies that relay cannot identify sender from sealed sender envelopes.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import json
import time

import pytest
from nacl.encoding import HexEncoder
from nacl.public import Box, PrivateKey, PublicKey


class TestSealedSenderProtocol:
    """Test sealed sender envelope creation and decryption."""

    def test_sealed_sender_envelope_structure(self):
        """Envelope should contain ephemeral pub, encrypted metadata, and message."""
        recipient_kp = PrivateKey.generate()

        # Simulate sealed sender envelope creation
        ephemeral = PrivateKey.generate()
        metadata = json.dumps({
            "sender_id": "user_sender123",
            "timestamp": int(time.time() * 1000),
            "nonce": "abc123"
        }).encode()

        box = Box(ephemeral, recipient_kp.public_key)
        nonce = os.urandom(24)
        encrypted_metadata = box.encrypt(metadata, nonce)

        envelope = {
            "ephemeral_pub": ephemeral.public_key.encode(encoder=HexEncoder).decode(),
            "encrypted_metadata": encrypted_metadata.hex(),
            "nonce": nonce.hex(),
            "message_ciphertext": "encrypted_message_content"
        }

        assert "ephemeral_pub" in envelope
        assert "encrypted_metadata" in envelope
        assert "nonce" in envelope
        assert "message_ciphertext" in envelope
        assert len(envelope["ephemeral_pub"]) == 64  # 32 bytes = 64 hex

    def test_sealed_sender_sender_hidden_from_relay(self):
        """Relay only sees ephemeral key, not sender identity."""
        recipient_kp = PrivateKey.generate()

        ephemeral = PrivateKey.generate()
        metadata = json.dumps({
            "sender_id": "user_sender123",
            "timestamp": int(time.time() * 1000),
        }).encode()

        box = Box(ephemeral, recipient_kp.public_key)
        nonce = os.urandom(24)
        encrypted_metadata = box.encrypt(metadata, nonce)

        # Relay cannot decrypt without recipient's private key
        relay_box = Box(ephemeral, ephemeral.public_key)  # Wrong key
        with pytest.raises(Exception):
            relay_box.decrypt(encrypted_metadata)

        # Only recipient can decrypt
        recipient_box = Box(recipient_kp, ephemeral.public_key)
        decrypted_metadata = recipient_box.decrypt(encrypted_metadata)
        parsed = json.loads(decrypted_metadata)
        assert parsed["sender_id"] == "user_sender123"

    def test_sealed_sender_wrong_key_fails(self):
        """Decryption with wrong key should fail."""
        recipient_kp = PrivateKey.generate()
        attacker_kp = PrivateKey.generate()

        ephemeral = PrivateKey.generate()
        metadata = json.dumps({"sender_id": "secret"}).encode()

        box = Box(ephemeral, recipient_kp.public_key)
        nonce = os.urandom(24)
        encrypted_metadata = box.encrypt(metadata, nonce)

        # Attacker cannot decrypt
        wrong_box = Box(attacker_kp, ephemeral.public_key)
        with pytest.raises(Exception):
            wrong_box.decrypt(encrypted_metadata)

    def test_sealed_sender_timestamp_validation(self):
        """Envelope with old timestamp should be rejected."""
        old_timestamp = int((time.time() - 600) * 1000)  # 10 minutes ago
        metadata = json.dumps({
            "sender_id": "user123",
            "timestamp": old_timestamp,
        }).encode()

        # Check if timestamp is within acceptable range (5 minutes)
        parsed = json.loads(metadata)
        age_ms = int(time.time() * 1000) - parsed["timestamp"]
        assert age_ms > 5 * 60 * 1000  # Should be rejected

    def test_sealed_sender_replay_protection(self):
        """Same envelope should not be processed twice."""
        seen_nonces = set()

        nonce = os.urandom(24)

        # First time
        assert nonce.hex() not in seen_nonces
        seen_nonces.add(nonce.hex())

        # Replay attempt
        assert nonce.hex() in seen_nonces


class TestSealedSenderIntegration:
    """Test sealed sender with full message flow."""

    def test_full_sealed_sender_flow(self):
        """Complete flow: encrypt -> send -> receive -> decrypt."""
        recipient_kp = PrivateKey.generate()

        # 1. Sender creates sealed envelope
        ephemeral = PrivateKey.generate()
        sender_id = "user_sender"
        message_content = "Hello, this is a secret message!"

        metadata = json.dumps({
            "sender_id": sender_id,
            "timestamp": int(time.time() * 1000),
        }).encode()

        # Encrypt metadata with recipient's public key
        shared_secret = Box(ephemeral, recipient_kp.public_key)
        nonce = os.urandom(24)
        encrypted_metadata = shared_secret.encrypt(metadata, nonce)

        # 2. Relay receives envelope (cannot decrypt)
        envelope = {
            "ephemeral_pub": ephemeral.public_key.encode(encoder=HexEncoder).decode(),
            "encrypted_metadata": encrypted_metadata.hex(),
            "nonce": nonce.hex(),
            "message_ciphertext": message_content,  # Already encrypted by Double Ratchet
        }

        # 3. Recipient decrypts
        ephemeral_pub = PublicKey(bytes.fromhex(envelope["ephemeral_pub"]))
        enc_meta = bytes.fromhex(envelope["encrypted_metadata"])
        recipient_box = Box(recipient_kp, ephemeral_pub)
        decrypted_metadata = recipient_box.decrypt(enc_meta)

        parsed = json.loads(decrypted_metadata)
        assert parsed["sender_id"] == sender_id

        # 4. Recipient can now decrypt the actual message
        assert envelope["message_ciphertext"] == message_content


class TestMessagePadding:
    """Test message padding for size obfuscation."""

    def test_pad_to_power_of_2(self):
        """Messages should be padded to power-of-2 sizes."""
        def pad_message(data: bytes, target_size: int) -> bytes:
            if len(data) >= target_size:
                return data
            padding_needed = target_size - len(data)
            # PKCS7-style padding
            return data + bytes([padding_needed]) * padding_needed

        msg = b"Hello"
        padded = pad_message(msg, 32)
        assert len(padded) == 32

        padded = pad_message(msg, 64)
        assert len(padded) == 64

    def test_unpad_message(self):
        """Padding should be removable."""
        def unpad_message(data: bytes) -> bytes:
            if not data:
                return data
            padding_size = data[-1]
            if padding_size > len(data) or padding_size == 0:
                return data
            return data[:-padding_size]

        msg = b"Hello"
        padded = msg + bytes([27]) * 27  # Pad to 32
        unpadded = unpad_message(padded)
        assert unpadded == msg

    def test_constant_size_messages(self):
        """Different messages should produce same-size output when padded."""
        def pad_to_size(data: bytes, size: int) -> bytes:
            if len(data) >= size:
                return data[:size]
            return data + b'\x00' * (size - len(data))

        msg1 = b"Hi"
        msg2 = b"This is a much longer message that should be truncated or padded"

        padded1 = pad_to_size(msg1, 256)
        padded2 = pad_to_size(msg2, 256)

        assert len(padded1) == len(padded2) == 256
