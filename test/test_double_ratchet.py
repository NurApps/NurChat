"""
Double Ratchet implementation tests for NurChat.
Tests forward secrecy, replay protection, X3DH key agreement, and automatic key rotation.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from nacl.encoding import HexEncoder
from nacl.public import PrivateKey

from shared.double_ratchet import DoubleRatchetSession, KDFChain, PreKeyBundle, hkdf


class TestKDFChain:
    def test_chain_advances(self):
        key = b"\x01" * 32
        chain = KDFChain(key)
        msg_key1, chain2 = chain.next_message_key(b"")
        msg_key2, chain3 = chain2.next_message_key(b"")
        assert msg_key1 != msg_key2
        assert chain2.step == 1
        assert chain3.step == 2

    def test_deterministic_replay(self):
        key = b"\x02" * 32
        chain1 = KDFChain(key)
        chain2 = KDFChain(key)
        mk1a, _ = chain1.next_message_key(b"")
        mk1b, _ = chain2.next_message_key(b"")
        assert mk1a == mk1b


class TestX3DH:
    def test_x3dh_key_agreement(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()
        bob_spk = PrivateKey.generate()

        sk_alice, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_ik,
            bob_ik.public_key,
            bob_spk.public_key,
        )

        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_ik,
            bob_spk,
            None,
            alice_ik.public_key,
            ephemeral.public_key,
        )

        assert sk_alice == sk_bob
        assert len(sk_alice) == 32

    def test_x3dh_with_one_time_prekey(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()
        bob_spk = PrivateKey.generate()
        bob_otpk = PrivateKey.generate()

        sk_alice, ephemeral = DoubleRatchetSession.x3dh_initialize(
            alice_ik,
            bob_ik.public_key,
            bob_spk.public_key,
            bob_otpk.public_key,
        )

        sk_bob = DoubleRatchetSession.x3dh_receive(
            bob_ik,
            bob_spk,
            bob_otpk,
            alice_ik.public_key,
            ephemeral.public_key,
        )

        assert sk_alice == sk_bob
        assert len(sk_alice) == 32


class TestDoubleRatchetSession:
    def test_alice_bob_roundtrip(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(
            alice_ik,
            bob_ik.public_key,
            bob_ik.public_key,
        )

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(
            bob_ik,
            bob_ik,
            None,
            alice_ik.public_key,
            alice.DHs.public_key,
        )

        plaintext = "Hello, Bob! This is a secret message."
        envelope = alice.encrypt_message(plaintext)
        decrypted = bob.decrypt_message(envelope)
        assert decrypted == plaintext

    def test_forward_secrecy_old_keys_gone(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        msg1 = alice.encrypt_message("First message")
        msg2 = alice.encrypt_message("Second message")
        msg3 = alice.encrypt_message("Third message")

        dec1 = bob.decrypt_message(msg1)
        dec2 = bob.decrypt_message(msg2)
        dec3 = bob.decrypt_message(msg3)

        assert dec1 == "First message"
        assert dec2 == "Second message"
        assert dec3 == "Third message"

        old_rk = bob.serialize()["RK"]

        # Bob sends a message — triggers DH ratchet, old root key is destroyed
        msg_from_bob = bob.encrypt_message("Bob replies")
        alice.decrypt_message(msg_from_bob)

        assert bob.serialize()["RK"] != old_rk

    def test_replay_protection(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        envelope = alice.encrypt_message("Original")
        bob.decrypt_message(envelope)

        with pytest.raises(ValueError, match="Replay attack"):
            bob.decrypt_message(envelope)

    def test_bidirectional_communication(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        msg_a1 = alice.encrypt_message("From Alice")
        msg_b1 = bob.encrypt_message("From Bob")
        msg_a2 = alice.encrypt_message("From Alice again")
        msg_b2 = bob.encrypt_message("From Bob again")

        assert bob.decrypt_message(msg_a1) == "From Alice"
        assert alice.decrypt_message(msg_b1) == "From Bob"
        assert bob.decrypt_message(msg_a2) == "From Alice again"
        assert alice.decrypt_message(msg_b2) == "From Bob again"

    def test_multiple_messages_chain(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        sent = []
        for i in range(50):
            msg = f"Message {i}"
            env = alice.encrypt_message(msg)
            sent.append((msg, env))

        for expected, env in sent:
            decrypted = bob.decrypt_message(env)
            assert decrypted == expected

    def test_session_serialization_roundtrip(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        env = alice.encrypt_message("Test")
        bob.decrypt_message(env)

        serialized = bob.serialize()
        restored = DoubleRatchetSession.deserialize(serialized)

        env2 = alice.encrypt_message("After reload")
        decrypted2 = restored.decrypt_message(env2)
        assert decrypted2 == "After reload"

    def test_wrong_key_rejected(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()
        eve_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        eve = DoubleRatchetSession()
        eve.initialize_as_bob(eve_ik, eve_ik, None, alice_ik.public_key, alice.DHs.public_key)

        envelope = alice.encrypt_message("Secret")

        with pytest.raises(Exception):
            eve.decrypt_message(envelope)

    def test_alice_receives_first(self):
        """Bob sends first message before Alice sends any."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        msg_from_bob = bob.encrypt_message("Bob's first")
        decrypted = alice.decrypt_message(msg_from_bob)
        assert decrypted == "Bob's first"

    def test_many_messages_forward_secrecy(self):
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        for i in range(5):
            env = alice.encrypt_message(f"msg {i}")
            bob.decrypt_message(env)

        old_rk = bob.serialize()["RK"]

        bob.encrypt_message("Bob ratchets")
        new_rk = bob.serialize()["RK"]
        assert new_rk != old_rk

    def test_old_message_rejected(self):
        """Messages with lower message number than current chain step are rejected."""
        alice_ik = PrivateKey.generate()
        bob_ik = PrivateKey.generate()

        alice = DoubleRatchetSession()
        alice.initialize_as_alice(alice_ik, bob_ik.public_key, bob_ik.public_key)

        bob = DoubleRatchetSession()
        bob.initialize_as_bob(bob_ik, bob_ik, None, alice_ik.public_key, alice.DHs.public_key)

        env1 = alice.encrypt_message("First")
        env2 = alice.encrypt_message("Second")
        env3 = alice.encrypt_message("Third")

        bob.decrypt_message(env1)
        bob.decrypt_message(env2)
        bob.decrypt_message(env3)

        # Replay old message should be rejected
        with pytest.raises(ValueError, match="Replay attack"):
            bob.decrypt_message(env1)

        # Message number lower than current step should be rejected
        env_old = alice.encrypt_message("Old style")
        env_old["header"]["ns"] = 0  # tampered - would fail at chain skip or replay
        with pytest.raises((ValueError, Exception)):
            bob.decrypt_message(env_old)


class TestHKDF:
    def test_hkdf_basic(self):
        result = hkdf(b"salt", b"ikm", b"info", 32)
        assert len(result) == 32

    def test_hkdf_different_salt_differs(self):
        r1 = hkdf(b"salt1", b"ikm", b"info", 32)
        r2 = hkdf(b"salt2", b"ikm", b"info", 32)
        assert r1 != r2

    def test_hkdf_long_output(self):
        result = hkdf(b"salt", b"ikm", b"info", 64)
        assert len(result) == 64


class TestPreKeyBundle:
    def test_generate_bundle(self):
        ik = PrivateKey.generate()
        spk = PrivateKey.generate()
        bundle = PreKeyBundle.generate(ik, spk, num_one_time=10)
        assert len(bundle.one_time_prekeys) == 10
        assert bundle.registration_id > 0

    def test_bundle_serialization(self):
        ik = PrivateKey.generate()
        spk = PrivateKey.generate()
        bundle = PreKeyBundle.generate(ik, spk, num_one_time=5)
        d = bundle.to_dict()
        assert d["identity_key"] == ik.public_key.encode(encoder=HexEncoder).decode()
        assert len(d["one_time_prekeys"]) == 5
