from __future__ import annotations

import base64
import hashlib
import os

import nacl.public
import nacl.secret
import nacl.utils
from nacl.encoding import RawEncoder
from nacl.public import PrivateKey, PublicKey, SealedBox


def ensure(raw: bytes | None, n: int) -> bytes:
    if not raw or len(raw) != n:
        return os.urandom(n)
    return raw


class Keypair:
    def __init__(self, private: bytes | None = None, public: bytes | None = None):
        self._private: PrivateKey | None = None
        self._public: PublicKey | None = None
        if private:
            self._private = PrivateKey(private, encoder=RawEncoder)
            self._public = self._private.public_key
        elif public:
            self._public = PublicKey(public, encoder=RawEncoder)

    @property
    def public(self) -> bytes:
        return self._public.encode(encoder=RawEncoder) if self._public else b""

    @property
    def private(self) -> bytes | None:
        return self._private.encode(encoder=RawEncoder) if self._private else None

    @classmethod
    def generate(cls) -> Keypair:
        sk = PrivateKey.generate()
        return cls(private=sk.encode(encoder=RawEncoder))


class ChatCrypto:
    def __init__(self):
        self._keys: dict[str, bytes] = {}
        self._kp = Keypair.generate()

    @property
    def my_pub(self) -> bytes:
        return self._kp.public

    def init_chat(self, chat_id: str, peers_pub: list[bytes], is_creator: bool = False) -> bytes:
        if is_creator:
            key = nacl.utils.random(nacl.secret.SecretBox.KEY_SIZE)
            self._keys[chat_id] = key
            return key
        return b""

    def get_or_create_key(self, chat_id: str) -> bytes:
        if chat_id not in self._keys:
            self._keys[chat_id] = nacl.utils.random(nacl.secret.SecretBox.KEY_SIZE)
        return self._keys[chat_id]

    def encrypt(self, chat_id: str, plaintext: str) -> str:
        key = self.get_or_create_key(chat_id)
        box = nacl.secret.SecretBox(key)
        nonce = nacl.utils.random(nacl.secret.SecretBox.NONCE_SIZE)
        enc = box.encrypt(plaintext.encode("utf-8"), nonce)
        return "enc:" + base64.b64encode(enc).decode("ascii")

    def decrypt(self, chat_id: str, data: str) -> str:
        if not data.startswith("enc:"):
            return data
        key = self.get_or_create_key(chat_id)
        box = nacl.secret.SecretBox(key)
        raw = base64.b64decode(data[4:])
        return box.decrypt(raw).decode("utf-8")

    def seal_for(self, peer_pub: bytes, key: bytes) -> str:
        box = SealedBox(PublicKey(peer_pub, encoder=RawEncoder))
        return base64.b64encode(box.encrypt(key)).decode("ascii")

    def unseal(self, peer_pub_enc: str) -> bytes:
        if not self._kp.private:
            raise RuntimeError("no private key")
        box = SealedBox(self._kp)
        return box.decrypt(base64.b64decode(peer_pub_enc))

    @staticmethod
    def chat_key_hash(chat_id: str, peer_ids: list[str]) -> str:
        raw = (chat_id + ":" + ",".join(sorted(peer_ids))).encode("utf-8")
        return hashlib.sha256(raw).hexdigest()[:32]
