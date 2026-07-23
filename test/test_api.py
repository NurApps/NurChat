import re
import pytest
from fastapi.testclient import TestClient

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
    nums = re.findall(r"\d+", q)
    answer = str(int(nums[0]) + int(nums[1])) if len(nums) >= 2 else "0"
    return data["captcha_id"], answer


def _register_user(username="testuser", password="TestPass123", first_name="Test") -> dict:
    cid, ans = _solve_captcha()
    csrf = _csrf_headers()
    r = client.post("/api/auth/register", json={
        "username": username, "password": password,
        "first_name": first_name,
        "captcha_id": cid, "captcha_code": ans,
    }, headers=csrf)
    assert r.status_code == 200, f"Register failed: {r.text}"
    return r.json()


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()


@pytest.fixture(autouse=True)
def _clear_db():
    from server.core.database import SessionLocal
    from server.core import models
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
            content=b"x" * (11 * 1024 * 1024),
            headers={"Content-Type": "application/json"},
        )
        assert r.status_code == 413
