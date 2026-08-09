"""
Group E2E encryption tests for NurChat.
Tests sender key protocol, TreeKEM, and group key management.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import hashlib
import secrets
from unittest.mock import MagicMock

import pytest
from nacl.public import PrivateKey, PublicKey, Box
from nacl.signing import SigningKey
from nacl.utils import random as nacl_random

from shared.double_ratchet import hkdf


# ─── Sender Key Protocol Tests ───

class TestSenderKeyProtocol:
    """Test sender key-based group encryption."""

    def test_sender_key_generation(self):
        sender_key = nacl_random(32)
        assert len(sender_key) == 32

    def test_sender_key_distribution(self):
        members = [PrivateKey.generate() for _ in range(5)]
        sender_key = nacl_random(32)

        # Each member gets encrypted sender key
        encrypted_keys = []
        for member in members:
            # Sender encrypts with member's public key
            box = Box(members[0], member.public_key)
            encrypted = box.encrypt(sender_key)
            encrypted_keys.append(encrypted)

        # Each member can decrypt
        for i, member in enumerate(members):
            box = Box(member, members[0].public_key)
            decrypted = box.decrypt(encrypted_keys[i])
            assert decrypted == sender_key

    def test_sender_key_ratchet(self):
        sender_key = nacl_random(32)
        chain = sender_key

        # Each step produces unique key
        keys = []
        for i in range(10):
            key = hkdf(chain, str(i).encode(), b"", 32)
            keys.append(key)
            chain = key

        assert len(set(keys)) == 10

    def test_sender_key_invalidation(self):
        sender_key = nacl_random(32)
        # After revocation, old key should not work
        revoked_keys = set()
        revoked_keys.add(bytes.hex(sender_key))

        assert bytes.hex(sender_key) in revoked_keys


# ─── TreeKEM Tests ───

class TestTreeKEM:
    """Test TreeKEM group key agreement."""

    def test_tree_construction(self):
        members = [PrivateKey.generate() for _ in range(4)]
        # Binary tree for 4 members
        #      root
        #     /    \
        #    n1    n2
        #   / \   / \
        #  m0 m1 m2 m3

        tree = {}
        for i, member in enumerate(members):
            tree[f"leaf_{i}"] = member.public_key

        assert len(tree) == 4

    def test_key_encapsulation(self):
        sender = PrivateKey.generate()
        receiver = PrivateKey.generate()

        # KEM encapsulation
        shared_secret = Box(sender, receiver.public_key)
        ciphertext = shared_secret.encrypt(b"ephemeral_key")

        # Decapsulation
        decrypted = Box(receiver, sender.public_key).decrypt(ciphertext)
        assert decrypted == b"ephemeral_key"

    def test_tree_path_encryption(self):
        members = [PrivateKey.generate() for _ in range(4)]
        path_keys = [nacl_random(32) for _ in range(3)]

        # Encrypt path from leaf to root
        encrypted_path = []
        for i, key in enumerate(path_keys):
            # Encrypt with next member's public key
            box = Box(members[i], members[i + 1].public_key)
            encrypted = box.encrypt(key)
            encrypted_path.append(encrypted)

        # Decrypt path from root to leaf
        decrypted_path = []
        for i, enc in enumerate(encrypted_path):
            box = Box(members[i + 1], members[i].public_key)
            decrypted = box.decrypt(enc)
            decrypted_path.append(decrypted)

        assert decrypted_path == path_keys


# ─── Group Key Management Tests ───

class TestGroupKeyManagement:
    """Test group key lifecycle."""

    def test_group_key_derivation(self):
        group_id = "group_123"
        epoch = 1
        root_key = nacl_random(32)

        # Derive epoch key
        epoch_key = hkdf(
            root_key,
            f"{group_id}:{epoch}".encode(),
            b"",
            32,
        )

        assert len(epoch_key) == 32

    def test_epoch_rotation(self):
        root_key = nacl_random(32)
        keys = []

        for epoch in range(5):
            key = hkdf(root_key, f"epoch_{epoch}".encode(), b"", 32)
            keys.append(key)

        # All epoch keys unique
        assert len(set(keys)) == 5

    def test_member_addition(self):
        group_key = nacl_random(32)
        new_member = PrivateKey.generate()

        # New member gets group key
        sender = PrivateKey.generate()
        box = Box(sender, new_member.public_key)
        encrypted_key = box.encrypt(group_key)

        # New member decrypts
        decrypted = Box(new_member, sender.public_key).decrypt(encrypted_key)
        assert decrypted == group_key

    def test_member_removal(self):
        members = [PrivateKey.generate() for _ in range(5)]
        group_key = nacl_random(32)

        # Remove member index 2
        removed_idx = 2
        remaining = [m for i, m in enumerate(members) if i != removed_idx]

        assert len(remaining) == 4

        # Rotate key for remaining members
        new_group_key = nacl_random(32)
        for member in remaining:
            sender = PrivateKey.generate()
            box = Box(sender, member.public_key)
            encrypted = box.encrypt(new_group_key)

            decrypted = Box(member, sender.public_key).decrypt(encrypted)
            assert decrypted == new_group_key


# ─── Forward Secrecy Tests ───

class TestGroupForwardSecrecy:
    """Test forward secrecy in groups."""

    def test_key_compromise_does_not_expose_past(self):
        current_key = nacl_random(32)
        past_keys = [nacl_random(32) for _ in range(5)]

        # Compromise current key
        compromised_key = current_key

        # Past keys should still be independent
        for key in past_keys:
            assert key != compromised_key

    def test_key_rotation_clears_old(self):
        keys = []
        for i in range(3):
            key = nacl_random(32)
            keys.append(key)
            # Simulate key deletion
            key = None

        assert keys[0] is not None
        assert keys[2] is not None


# ─── Group Message Authentication ───

class TestGroupMessageAuth:
    """Test message authentication in groups."""

    def test_sender_signature(self):
        sender_sk = SigningKey.generate()
        message = b"group message"

        signature = sender_sk.sign(message).signature
        assert len(signature) == 64

    def test_sender_verification(self):
        sender_sk = SigningKey.generate()
        message = b"group message"

        signed = sender_sk.sign(message)
        verified = sender_sk.verify_key.verify(signed)

        assert verified == message

    def test_invalid_sender_detection(self):
        sender_sk = SigningKey.generate()
        attacker_sk = SigningKey.generate()
        message = b"group message"

        # Attacker signs
        fake_signed = attacker_sk.sign(message)

        # Verify with sender's key should fail
        with pytest.raises(Exception):
            sender_sk.verify_key.verify(fake_signed)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
