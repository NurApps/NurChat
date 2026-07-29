"""
E2E Encryption Tests for NurChat
Standalone tests — no server required
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import nacl.signing
import pytest

from shared.p2p_encryption import P2PEncryption


@pytest.fixture
def p2p():
    return P2PEncryption()


class TestSymmetricKey:
    def test_generate_key_returns_32_bytes(self, p2p):
        key = p2p.generate_symmetric_key()
        assert len(key) == 32

    def test_generate_key_is_bytes(self, p2p):
        key = p2p.generate_symmetric_key()
        assert isinstance(key, bytes)

    def test_two_keys_are_different(self, p2p):
        key1 = p2p.generate_symmetric_key()
        key2 = p2p.generate_symmetric_key()
        assert key1 != key2


class TestAsymmetricKeys:
    def test_generate_keypair(self, p2p):
        private_key, public_key = p2p.generate_asymmetric_keys()
        assert private_key is not None
        assert public_key is not None

    def test_keypair_length(self, p2p):
        private_key, public_key = p2p.generate_asymmetric_keys()
        assert len(private_key) == 64  # 32 bytes hex = 64 chars
        assert len(public_key) == 64

    def test_private_neq_public(self, p2p):
        private_key, public_key = p2p.generate_asymmetric_keys()
        assert private_key != public_key


class TestSharedKey:
    def test_shared_key_from_password(self, p2p):
        key1, salt = p2p.create_shared_key("password123")
        key2, _ = p2p.create_shared_key("password123", salt)
        assert key1 == key2

    def test_shared_key_length(self, p2p):
        key, _ = p2p.create_shared_key("test")
        assert len(key) == 32

    def test_different_passwords_different_keys(self, p2p):
        key1, salt1 = p2p.create_shared_key("pass1")
        key2, salt2 = p2p.create_shared_key("pass2")
        assert key1 != key2


class TestEncryptDecrypt:
    def test_basic_encrypt_decrypt(self, p2p):
        message = "Hello, World!"
        key = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)
        assert decrypted == message

    def test_encrypted_differs_from_original(self, p2p):
        message = "Secret"
        key = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat(message, key)
        assert encrypted != message

    def test_wrong_key_fails(self, p2p):
        message = "Secret"
        key1 = p2p.generate_symmetric_key()
        key2 = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat(message, key1)
        with pytest.raises(Exception):
            p2p.decrypt_for_chat(encrypted, key2)

    def test_empty_message(self, p2p):
        key = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat("", key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)
        assert decrypted == ""

    def test_long_message(self, p2p):
        message = "A" * 10000
        key = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)
        assert decrypted == message

    def test_unicode_message(self, p2p):
        message = "Привет! 你好! مرحبا! 🎉🔐"
        key = p2p.generate_symmetric_key()
        encrypted = p2p.encrypt_for_chat(message, key)
        decrypted = p2p.decrypt_for_chat(encrypted, key)
        assert decrypted == message


class TestPublicKeyEncryption:
    def test_encrypt_decrypt_key(self, p2p):
        private_key, public_key = p2p.generate_asymmetric_keys()
        original_key = p2p.generate_symmetric_key()

        encrypted_key = p2p.encrypt_key_with_public_key(original_key, public_key)
        decrypted_key = p2p.decrypt_key_with_private_key(encrypted_key, private_key)

        assert decrypted_key == original_key


class TestE2EProtocol:
    def test_full_e2e_flow(self, p2p):
        """Simulate full E2E: two users exchange encrypted message"""
        # User A
        priv_a, pub_a = p2p.generate_asymmetric_keys()
        # User B
        priv_b, pub_b = p2p.generate_asymmetric_keys()

        # Decode hex bytes to strings
        priv_a_str = priv_a.decode() if isinstance(priv_a, bytes) else priv_a
        pub_a_str = pub_a.decode() if isinstance(pub_a, bytes) else pub_a
        priv_b_str = priv_b.decode() if isinstance(priv_b, bytes) else priv_b
        pub_b_str = pub_b.decode() if isinstance(pub_b, bytes) else pub_b

        # Shared secret
        secret_a = p2p.derive_shared_secret(priv_a_str, pub_b_str)
        secret_b = p2p.derive_shared_secret(priv_b_str, pub_a_str)
        assert secret_a == secret_b

        # Derive chat key
        key_a = p2p.derive_chat_key(priv_a_str, pub_b_str, "chat_123")
        key_b = p2p.derive_chat_key(priv_b_str, pub_a_str, "chat_123")
        assert key_a == key_b

        # Encrypt/decrypt message
        message = "Salam alaikum!"
        encrypted = p2p.encrypt_for_chat(message, key_a)
        decrypted = p2p.decrypt_for_chat(encrypted, key_b)
        assert decrypted == message

    def test_sign_and_verify(self, p2p):
        """Sign/verify uses Ed25519 keys (separate from X25519 encryption keys)"""
        # Generate Ed25519 signing keys
        signing_sk = nacl.signing.SigningKey.generate()
        signing_vk = signing_sk.verify_key

        sk_hex = signing_sk.encode().hex()
        vk_hex = signing_vk.encode().hex()

        message = "Important message"
        signature = p2p.sign_message(message, sk_hex)
        assert p2p.verify_signature(message, signature, vk_hex)

    def test_verify_wrong_message(self, p2p):
        signing_sk = nacl.signing.SigningKey.generate()
        signing_vk = signing_sk.verify_key

        sk_hex = signing_sk.encode().hex()
        vk_hex = signing_vk.encode().hex()

        signature = p2p.sign_message("original", sk_hex)
        assert not p2p.verify_signature("tampered", signature, vk_hex)
