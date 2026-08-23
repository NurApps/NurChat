import io
import re

import pytest
from fastapi.testclient import TestClient
from nacl.encoding import HexEncoder
from nacl.public import PrivateKey
from nacl.signing import SigningKey

from server.main import app
from shared.rate_limiter import limiter

client = TestClient(app)


def _csrf_headers() -> dict:
    r = client.get("/health")
    token = r.cookies.get("csrf_token", "")
    return {"X-CSRF-Token": token}


def _solve_captcha() -> tuple[str, str]:
    r = client.get("/api/auth/captcha")
    assert r.status_code == 200
    data = r.json()
    q = data["question"]
    nums = [int(n) for n in re.findall(r"\d+", q)]
    if "×" in q or "x" in q:
        answer = nums[0] * nums[1]
    elif "-" in q:
        answer = nums[0] - nums[1]
    else:
        answer = nums[0] + nums[1]
    return data["captcha_id"], str(answer)


def _register_user(username="testuser", password="TestPass123", first_name="Test",
                   public_key="a" * 64, signing_public_key="b" * 64) -> dict:
    cid, ans = _solve_captcha()
    csrf = _csrf_headers()
    r = client.post("/api/auth/register", json={
        "username": username, "password": password,
        "first_name": first_name,
        "public_key": public_key,
        "signing_public_key": signing_public_key,
        "captcha_id": cid, "captcha_code": ans,
    }, headers=csrf)
    assert r.status_code == 200, f"Register failed: {r.text}"
    return r.json()


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()


@pytest.fixture(autouse=True)
def _clear_db():
    from server.core import models
    from server.core.database import SessionLocal
    db = SessionLocal()
    try:
        for table in [models.MessageReadStatus, models.Message,
                      models.ChatParticipant, models.Chat, models.User]:
            db.query(table).delete()
        db.commit()
    finally:
        db.close()


class TestAuth:
    def test_health(self):
        r = client.get("/health")
        assert r.status_code == 200
        assert r.json()["status"] == "healthy"

    def test_register_and_login(self):
        data = _register_user()
        assert "access_token" in data
        assert "refresh_token" in data
        assert "user" in data
        assert data["user"]["username"] == "testuser"

        r = client.post("/api/auth/login", json={
            "username": "testuser", "password": "TestPass123",
        })
        assert r.status_code == 200
        body = r.json()
        assert "access_token" in body
        assert "refresh_token" in body

    def test_register_duplicate(self):
        _register_user()
        cid, ans = _solve_captcha()
        r = client.post("/api/auth/register", json={
            "username": "testuser", "password": "TestPass123",
            "first_name": "Dup",
            "captcha_id": cid, "captcha_code": ans,
        })
        assert r.status_code == 400

    def test_register_weak_password(self):
        cid, ans = _solve_captcha()
        r = client.post("/api/auth/register", json={
            "username": "weak_user", "password": "abc",
            "first_name": "Weak",
            "captcha_id": cid, "captcha_code": ans,
        })
        assert r.status_code == 400

    def test_login_wrong_password(self):
        _register_user()
        r = client.post("/api/auth/login", json={
            "username": "testuser", "password": "WrongPass123",
        })
        assert r.status_code == 401

    def test_me(self):
        data = _register_user()
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {data['access_token']}"})
        assert r.status_code == 200
        assert r.json()["username"] == "testuser"

    def test_refresh_token(self):
        data = _register_user()
        csrf = _csrf_headers()
        r = client.post("/api/auth/refresh", json={
            "refresh_token_str": data["refresh_token"],
        }, headers=csrf)
        assert r.status_code == 200
        assert "access_token" in r.json()

    def test_refresh_token_invalid(self):
        csrf = _csrf_headers()
        r = client.post("/api/auth/refresh", json={
            "refresh_token_str": "invalid_token_here",
        }, headers=csrf)
        assert r.status_code == 401

    def test_security_headers(self):
        r = client.get("/health")
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("x-frame-options") == "DENY"
        assert r.headers.get("referrer-policy") == "no-referrer"
        assert r.headers.get("permissions-policy") is not None
        assert r.headers.get("content-security-policy") is not None

    def test_cors_allowed(self):
        r = client.options("/health", headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
        })
        assert r.status_code == 200
        assert r.headers.get("access-control-allow-origin") == "http://localhost:5173"

    def test_cors_reject_unknown(self):
        r = client.options("/health", headers={
            "Origin": "http://evil.com",
            "Access-Control-Request-Method": "GET",
        })
        assert r.headers.get("access-control-allow-origin") != "http://evil.com"


class TestChat:
    def _auth_header(self) -> dict:
        data = _register_user()
        csrf = _csrf_headers()
        return {"Authorization": f"Bearer {data['access_token']}", **csrf}

    def _second_user(self) -> dict:
        return _register_user("user2", "Pass1234", "Second")

    def test_create_chat(self):
        h = self._auth_header()
        u2 = self._second_user()
        r = client.post("/api/chat/chats", json={
            "name": "Test Chat",
            "participant_ids": [u2["user"]["id"]],
            "is_group": False,
        }, headers=h)
        assert r.status_code == 200
        chat = r.json()
        assert "id" in chat
        assert not chat["is_group"]

    def test_send_and_get_messages(self):
        h = self._auth_header()
        u2 = self._second_user()
        r = client.post("/api/chat/chats", json={
            "name": "Chat", "participant_ids": [u2["user"]["id"]],
            "is_group": False,
        }, headers=h)
        chat_id = r.json()["id"]

        r = client.post(f"/api/chat/chats/{chat_id}/messages", json={
            "chat_id": chat_id, "content": "Hello!", "message_type": "text",
        }, headers=h)
        assert r.status_code == 200
        msg_id = r.json()["id"]

        r = client.get(f"/api/chat/chats/{chat_id}/messages", headers=h)
        assert r.status_code == 200
        messages = r.json()
        assert len(messages) >= 1
        assert any(m["id"] == msg_id for m in messages)

    def test_body_size_limit(self):
        r = client.post(
            "/api/auth/login",
            content=b"x" * (51 * 1024 * 1024),
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 413


class TestFiles:
    def _auth_header(self) -> dict:
        data = _register_user()
        csrf = _csrf_headers()
        return {"Authorization": f"Bearer {data['access_token']}", **csrf}

    def test_upload_and_list_files(self):
        h = self._auth_header()
        file_content = b"fake_image_data_here"
        r = client.post(
            "/api/files/upload",
            data={"file_type": "image"},
            files={"file": ("test.png", io.BytesIO(file_content), "image/png")},
            headers=h,
        )
        assert r.status_code == 200, f"Upload failed: {r.text}"
        data = r.json()
        assert "id" in data
        assert data["file_type"] == "image"
        assert data["filename"] == "test.png"
        file_id = data["id"]

        r = client.get("/api/files/my-files", headers=h)
        assert r.status_code == 200
        files = r.json()
        assert any(f["id"] == file_id for f in files)

    def test_storage_info(self):
        h = self._auth_header()
        r = client.get("/api/files/storage-info", headers=h)
        assert r.status_code == 200
        data = r.json()
        assert "total_size" in data
        assert "file_count" in data
        assert "max_storage" in data

    def test_upload_invalid_type_fails(self):
        h = self._auth_header()
        r = client.post(
            "/api/files/upload",
            data={"file_type": "invalid_type"},
            files={"file": ("test.txt", io.BytesIO(b"test"), "text/plain")},
            headers=h,
        )
        assert r.status_code == 422

    def test_delete_file(self):
        h = self._auth_header()
        file_content = b"delete_me"
        r = client.post(
            "/api/files/upload",
            data={"file_type": "document"},
            files={"file": ("delete.txt", io.BytesIO(file_content), "text/plain")},
            headers=h,
        )
        assert r.status_code == 200
        file_id = r.json()["id"]

        r = client.delete(f"/api/files/delete/{file_id}", headers=h)
        assert r.status_code == 200

        r = client.delete(f"/api/files/delete/{file_id}", headers=h)
        assert r.status_code == 404


class TestKeys:
    def _identity(self):
        box_kp = PrivateKey.generate()
        sign_sk = SigningKey.generate()
        return (
            box_kp.public_key.encode(encoder=HexEncoder).decode(),
            sign_sk.verify_key.encode(encoder=HexEncoder).decode(),
            sign_sk,
        )

    def _auth_header(self):
        pub_key, sign_pub, sign_sk = self._identity()
        data = _register_user("keyuser", "KeyTest123", "KeyUser",
                              public_key=pub_key, signing_public_key=sign_pub)
        csrf = _csrf_headers()
        headers = {"Authorization": f"Bearer {data['access_token']}", **csrf}
        return headers, data["user"]["id"], sign_sk

    def _generate_signed_prekey(self, sign_sk: SigningKey) -> tuple[str, str]:
        sk = PrivateKey.generate()
        pub = sk.public_key.encode(encoder=HexEncoder).decode()
        sig = sign_sk.sign(sk.public_key.encode()).signature.hex()
        return pub, sig

    def test_upload_and_get_signed_prekey(self):
        h, user_id, sign_sk = self._auth_header()
        pub, sig = self._generate_signed_prekey(sign_sk)

        r = client.post("/api/keys/signed-prekey", params={
            "public_key": pub, "signature": sig,
        }, headers=h)
        assert r.status_code == 200

        r = client.get(f"/api/keys/signed-prekey/{user_id}", headers=h)
        assert r.status_code == 200
        data = r.json()
        assert data["public_key"] == pub
        assert data["signature"] == sig

    def test_upload_and_get_one_time_prekeys(self):
        h, user_id, sign_sk = self._auth_header()
        pub, sig = self._generate_signed_prekey(sign_sk)
        client.post("/api/keys/signed-prekey", params={
            "public_key": pub, "signature": sig,
        }, headers=h)

        # Generate keypairs client-side (new API accepts public_keys only)
        from nacl.public import PrivateKey
        pubs = []
        for _ in range(10):
            kp = PrivateKey.generate()
            pubs.append(kp.public_key.encode(encoder=HexEncoder).decode())

        r = client.post("/api/keys/one-time", json={"public_keys": pubs}, headers=h)
        assert r.status_code == 200
        data = r.json()
        assert data["count"] == 10

        r = client.get(f"/api/keys/one-time-count/{user_id}", headers=h)
        assert r.status_code == 200
        assert r.json()["count"] == 10

    def test_get_prekey_bundle(self):
        h, user_id, sign_sk = self._auth_header()
        pub, sig = self._generate_signed_prekey(sign_sk)
        client.post("/api/keys/signed-prekey", params={
            "public_key": pub, "signature": sig,
        }, headers=h)

        from nacl.public import PrivateKey
        pubs = []
        for _ in range(5):
            kp = PrivateKey.generate()
            pubs.append(kp.public_key.encode(encoder=HexEncoder).decode())
        client.post("/api/keys/one-time", json={"public_keys": pubs}, headers=h)

        r = client.get(f"/api/keys/bundle/{user_id}", headers=h)
        assert r.status_code == 200
        data = r.json()
        assert "identity_key" in data
        assert "signed_prekey" in data
        assert "one_time_prekey" in data
        assert data["one_time_prekey"] is not None
        assert "registration_id" in data

    def test_get_prekey_bundle_consumes_one_time(self):
        h, user_id, sign_sk = self._auth_header()
        pub, sig = self._generate_signed_prekey(sign_sk)
        client.post("/api/keys/signed-prekey", params={
            "public_key": pub, "signature": sig,
        }, headers=h)

        from nacl.public import PrivateKey
        pubs = []
        for _ in range(3):
            kp = PrivateKey.generate()
            pubs.append(kp.public_key.encode(encoder=HexEncoder).decode())
        client.post("/api/keys/one-time", json={"public_keys": pubs}, headers=h)

        r = client.get(f"/api/keys/bundle/{user_id}", headers=h)
        assert r.status_code == 200

        r = client.get(f"/api/keys/one-time-count/{user_id}", headers=h)
        assert r.json()["count"] == 2

    def test_prekey_bundle_not_found(self):
        h, _, _ = self._auth_header()
        r = client.get("/api/keys/bundle/nonexistent_user", headers=h)
        assert r.status_code == 404

    def test_cleanup_prekeys(self):
        h, _, _ = self._auth_header()
        r = client.post("/api/keys/cleanup", headers=h)
        assert r.status_code == 200
