"""
Double Ratchet implementation for NurChat
Implements X3DH + Double Ratchet (Signal Protocol)
- Forward secrecy: each ratchet step destroys previous keys
- Replay protection: message numbers tracked per session
- Automatic key rotation on every message
"""

import base64
import hashlib
import hmac
import struct
from typing import Optional

from nacl.encoding import HexEncoder
from nacl.public import PrivateKey, PublicKey, Box
import nacl.secret
import nacl.utils
import nacl.signing


def hkdf_extract(salt: bytes, ikm: bytes) -> bytes:
    return hmac.new(salt, ikm, hashlib.sha256).digest()


def hkdf_expand(prk: bytes, info: bytes, length: int) -> bytes:
    N = (length + 32 - 1) // 32
    t = b""
    okm = b""
    for i in range(1, N + 1):
        t = hmac.new(prk, t + info + struct.pack("B", i), hashlib.sha256).digest()
        okm += t
    return okm[:length]


def hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    prk = hkdf_extract(salt, ikm)
    return hkdf_expand(prk, info, length)


class KDFChain:
    """KDF chain that produces message keys with forward secrecy."""

    def __init__(self, key: bytes, step: int = 0):
        self.key = key
        self.step = step

    def next_message_key(self) -> tuple[bytes, "KDFChain"]:
        msg_key = hkdf(b"", self.key, b"msg_out", 32)
        next_key = hkdf(b"", self.key, b"msg_next", 32)
        return msg_key, KDFChain(next_key, self.step + 1)


class DoubleRatchetSession:
    """
    Double Ratchet session between two parties.

    State per spec:
      DHs  — our current DH ratchet private key
      DHr  — their current DH ratchet public key
      RK   — root key
      CKs  — sending chain key
      CKr  — receiving chain key
      Ns   — number of messages sent in sending chain
      Nr   — number of messages received in receiving chain
      PN   — number of messages in previous sending chain
    """

    def __init__(self):
        self.DHs: Optional[PrivateKey] = None
        self.DHr: Optional[PublicKey] = None
        self.RK: Optional[bytes] = None
        self.CKs: Optional[KDFChain] = None
        self.CKr: Optional[KDFChain] = None
        self.Ns: int = 0
        self.Nr: int = 0
        self.PN: int = 0

        self.our_identity_public: Optional[bytes] = None
        self.their_identity_public: Optional[bytes] = None

        self._seen_message_ids: set[tuple[str, int]] = set()

    def _associated_data(self) -> bytes:
        return (self.our_identity_public or b"") + (self.their_identity_public or b"")

    # ─── X3DH ───

    @staticmethod
    def x3dh_initialize(
        our_identity_private: PrivateKey,
        their_identity_public: PublicKey,
        their_signed_prekey_public: PublicKey,
        their_one_time_prekey_public: Optional[PublicKey] = None,
    ) -> tuple[bytes, PrivateKey]:
        ephemeral = PrivateKey.generate()
        dh1 = Box(our_identity_private, their_signed_prekey_public).shared_key()
        dh2 = Box(ephemeral, their_identity_public).shared_key()
        dh3 = Box(ephemeral, their_signed_prekey_public).shared_key()
        dh_input = dh1 + dh2 + dh3
        if their_one_time_prekey_public:
            dh4 = Box(ephemeral, their_one_time_prekey_public).shared_key()
            dh_input += dh4
        sk = hkdf(b"", dh_input, b"X3DH_SK", 32)
        return sk, ephemeral

    @staticmethod
    def x3dh_receive(
        our_identity_private: PrivateKey,
        our_signed_prekey_private: PrivateKey,
        our_one_time_prekey_private: Optional[PrivateKey],
        their_identity_public: PublicKey,
        their_ephemeral_public: PublicKey,
    ) -> bytes:
        dh1 = Box(our_signed_prekey_private, their_identity_public).shared_key()
        dh2 = Box(our_identity_private, their_ephemeral_public).shared_key()
        dh3 = Box(our_signed_prekey_private, their_ephemeral_public).shared_key()
        dh_input = dh1 + dh2 + dh3
        if our_one_time_prekey_private:
            dh4 = Box(our_one_time_prekey_private, their_ephemeral_public).shared_key()
            dh_input += dh4
        return hkdf(b"", dh_input, b"X3DH_SK", 32)

    def initialize_as_alice(
        self,
        our_identity_private: PrivateKey,
        their_identity_public: PublicKey,
        their_signed_prekey_public: PublicKey,
        their_one_time_prekey_public: Optional[PublicKey] = None,
    ):
        sk, ephemeral = self.x3dh_initialize(
            our_identity_private,
            their_identity_public,
            their_signed_prekey_public,
            their_one_time_prekey_public,
        )
        self.DHs = ephemeral
        self.DHr = their_signed_prekey_public
        self.our_identity_public = our_identity_private.public_key.encode()
        self.their_identity_public = their_identity_public.encode()

        derived = hkdf(sk, b"", b"DoubleRatchet_Init", 64)
        self.RK = derived[:32]
        self.CKs = KDFChain(derived[32:])
        self.CKr = None
        self.Ns = 0
        self.Nr = 0
        self.PN = 0

    def initialize_as_bob(
        self,
        our_identity_private: PrivateKey,
        our_signed_prekey_private: PrivateKey,
        our_one_time_prekey_private: Optional[PrivateKey],
        their_identity_public: PublicKey,
        their_ephemeral_public: PublicKey,
    ):
        sk = self.x3dh_receive(
            our_identity_private,
            our_signed_prekey_private,
            our_one_time_prekey_private,
            their_identity_public,
            their_ephemeral_public,
        )
        self.DHr = their_ephemeral_public
        self.DHs = our_signed_prekey_private
        self.our_identity_public = our_identity_private.public_key.encode()
        self.their_identity_public = their_identity_public.encode()

        derived = hkdf(sk, b"", b"DoubleRatchet_Init", 64)
        self.RK = derived[:32]
        self.CKr = KDFChain(derived[32:])
        self.CKs = None
        self.Ns = 0
        self.Nr = 0
        self.PN = 0

    # ─── DH Ratchet ───

    def _dh_ratchet_send(self):
        ratchet_private = PrivateKey.generate()
        dh_shared = Box(ratchet_private, self.DHr).shared_key()
        derived = hkdf(self.RK, dh_shared, b"DoubleRatchet_Ratchet", 64)
        self.RK = derived[:32]
        self.CKs = KDFChain(derived[32:])
        self.PN = self.Ns
        self.Ns = 0
        self.DHs = ratchet_private

    def _dh_ratchet_recv(self, their_public: PublicKey):
        dh_shared = Box(self.DHs, their_public).shared_key()
        derived = hkdf(self.RK, dh_shared, b"DoubleRatchet_Ratchet", 64)
        self.RK = derived[:32]
        self.CKr = KDFChain(derived[32:])
        self.PN = self.Ns
        self.Nr = 0
        self.DHr = their_public
        self.DHs = PrivateKey.generate()

    def encrypt_message(self, plaintext: str) -> dict:
        if self.CKs is None:
            if self.CKr is not None and self.DHr is not None:
                self._dh_ratchet_send()
            else:
                raise ValueError("No sending chain available")

        msg_key, self.CKs = self.CKs.next_message_key()
        nonce = nacl.utils.random(nacl.secret.SecretBox.NONCE_SIZE)
        box = nacl.secret.SecretBox(msg_key)
        ciphertext = box.encrypt(plaintext.encode("utf-8"), nonce)

        header = {
            "dh": self.DHs.public_key.encode(encoder=HexEncoder).decode(),
            "pn": self.PN,
            "ns": self.Ns,
        }
        ad = self._associated_data()

        envelope = {
            "header": header,
            "ciphertext": base64.b64encode(ciphertext).decode("utf-8"),
            "ad": base64.b64encode(ad).decode("utf-8"),
        }

        self.Ns += 1
        return envelope

    # ─── Decrypt ───

    def decrypt_message(self, envelope: dict) -> str:
        header = envelope["header"]
        dh_hex = header["dh"]
        pn = header["pn"]
        ns = header["ns"]

        their_ratchet = PublicKey(bytes.fromhex(dh_hex))

        msg_id = (dh_hex, ns)
        if msg_id in self._seen_message_ids:
            raise ValueError("Replay attack detected")

        if self.DHr is None or their_ratchet.encode() != self.DHr.encode():
            self.PN = pn
            self._dh_ratchet_recv(their_ratchet)

        if self.CKr is None:
            raise ValueError("No receiving chain available")

        if ns < self.CKr.step:
            raise ValueError(f"Message number {ns} is in the past (chain at {self.CKr.step})")

        chain = self.CKr
        while chain.step < ns:
            _, chain = chain.next_message_key()

        msg_key, self.CKr = chain.next_message_key()
        self.Nr += 1

        self._seen_message_ids.add(msg_id)
        if len(self._seen_message_ids) > 10000:
            self._seen_message_ids = set(list(self._seen_message_ids)[-5000:])

        ciphertext_bytes = base64.b64decode(envelope["ciphertext"])
        box = nacl.secret.SecretBox(msg_key)
        plaintext = box.decrypt(ciphertext_bytes)
        return plaintext.decode("utf-8")

    # ─── Serialization ───

    def serialize(self) -> dict:
        return {
            "DHs": self.DHs.encode(encoder=HexEncoder).decode() if self.DHs else None,
            "DHr": self.DHr.encode(encoder=HexEncoder).decode() if self.DHr else None,
            "RK": base64.b64encode(self.RK).decode() if self.RK else None,
            "CKs": base64.b64encode(self.CKs.key).decode() if self.CKs else None,
            "CKr": base64.b64encode(self.CKr.key).decode() if self.CKr else None,
            "CKs_step": self.CKs.step if self.CKs else 0,
            "CKr_step": self.CKr.step if self.CKr else 0,
            "Ns": self.Ns,
            "Nr": self.Nr,
            "PN": self.PN,
            "our_id": base64.b64encode(self.our_identity_public).decode() if self.our_identity_public else None,
            "their_id": base64.b64encode(self.their_identity_public).decode() if self.their_identity_public else None,
        }

    @staticmethod
    def deserialize(data: dict) -> "DoubleRatchetSession":
        s = DoubleRatchetSession()
        if data.get("DHs"):
            s.DHs = PrivateKey(bytes.fromhex(data["DHs"]))
        if data.get("DHr"):
            s.DHr = PublicKey(bytes.fromhex(data["DHr"]))
        if data.get("RK"):
            s.RK = base64.b64decode(data["RK"])
        if data.get("CKs"):
            s.CKs = KDFChain(base64.b64decode(data["CKs"]), data.get("CKs_step", 0))
        if data.get("CKr"):
            s.CKr = KDFChain(base64.b64decode(data["CKr"]), data.get("CKr_step", 0))
        s.Ns = data.get("Ns", 0)
        s.Nr = data.get("Nr", 0)
        s.PN = data.get("PN", 0)
        if data.get("our_id"):
            s.our_identity_public = base64.b64decode(data["our_id"])
        if data.get("their_id"):
            s.their_identity_public = base64.b64decode(data["their_id"])
        return s


class PreKeyBundle:
    """
    Bundle of pre-keys for X3DH session establishment.
    Published so other users can initiate encrypted sessions.
    """

    def __init__(
        self,
        identity_key: PublicKey,
        signed_prekey: PublicKey,
        signed_prekey_signature: bytes,
        one_time_prekeys: list[PublicKey],
        registration_id: int,
    ):
        self.identity_key = identity_key
        self.signed_prekey = signed_prekey
        self.signed_prekey_signature = signed_prekey_signature
        self.one_time_prekeys = one_time_prekeys
        self.registration_id = registration_id

    def to_dict(self) -> dict:
        return {
            "identity_key": self.identity_key.encode(encoder=HexEncoder).decode(),
            "signed_prekey": self.signed_prekey.encode(encoder=HexEncoder).decode(),
            "signed_prekey_signature": base64.b64encode(self.signed_prekey_signature).decode(),
            "one_time_prekeys": [k.encode(encoder=HexEncoder).decode() for k in self.one_time_prekeys],
            "registration_id": self.registration_id,
        }

    @staticmethod
    def generate(
        identity_private: PrivateKey,
        signed_prekey_private: PrivateKey,
        num_one_time: int = 100,
        registration_id: Optional[int] = None,
    ) -> "PreKeyBundle":
        if registration_id is None:
            import random
            registration_id = random.randint(1, 0xFFFFFF)

        identity_pub = identity_private.public_key
        signed_prekey_pub = signed_prekey_private.public_key

        sign_key = nacl.signing.SigningKey(identity_private.encode())
        signature = sign_key.sign(signed_prekey_pub.encode()).signature

        one_time = [PrivateKey.generate().public_key for _ in range(num_one_time)]

        return PreKeyBundle(
            identity_key=identity_pub,
            signed_prekey=signed_prekey_pub,
            signed_prekey_signature=signature,
            one_time_prekeys=one_time,
            registration_id=registration_id,
        )
