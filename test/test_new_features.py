"""Integration tests for contact requests and view-once media."""
import os
import re
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

_ip_counter = [0]
_register_counter = [0]


def _make_engine():
    return create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )


@pytest.fixture(autouse=True)
def setup_db():
    engine = _make_engine()
    test_session = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    from server.core import models  # noqa
    from server.core.database import Base, get_db

    Base.metadata.create_all(bind=engine)

    import server.core.database as db_module
    old_engine = db_module.engine
    old_session = db_module.SessionLocal
    db_module.engine = engine
    db_module.SessionLocal = test_session

    from server.main import app

    def override_get_db():
        db = test_session()
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    _ip_counter[0] = 0
    _register_counter[0] = 0

    # Reset rate limiter state between tests
    from slowapi import Limiter
    from slowapi.util import get_remote_address

    from shared.rate_limiter import limiter
    limiter.__dict__.update(Limiter(key_func=get_remote_address).__dict__)

    yield

    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    db_module.engine = old_engine
    db_module.SessionLocal = old_session
    app.dependency_overrides.pop(get_db, None)


@pytest.fixture
def client():
    from server.main import app
    with patch("server.main.create_tables"):
        with patch("server.middleware.csrf.CSRFMiddleware._is_exempt_path", return_value=True):
            with patch("server.ws.chat_manager.connection_manager.send_personal_message", new_callable=AsyncMock):
                with patch("server.ws.chat_manager.connection_manager.broadcast_to_chat", new_callable=AsyncMock):
                    with patch("server.ws.chat_manager.connection_manager.add_user_to_chat"):
                        with TestClient(app, raise_server_exceptions=False) as c:
                            yield c


def _register(client, public_key: str = "a" * 64, signing_public_key: str = "b" * 64) -> dict:
    _register_counter[0] += 1
    ip = f"10.0.0.{_register_counter[0]}"
    cid, ans = _solve_captcha(client)
    resp = client.post(
        "/api/auth/register",
        json={
            "username": f"user_{_register_counter[0]}",
            "password": "TestPass123",
            "first_name": f"User{_register_counter[0]}",
            "public_key": public_key,
            "signing_public_key": signing_public_key,
            "captcha_id": cid,
            "captcha_code": ans,
        },
        headers={"X-Forwarded-For": ip},
    )
    assert resp.status_code == 200, f"Register failed: {resp.status_code} {resp.json()}"
    data = resp.json()
    return {"id": data["user"]["id"], "token": data["access_token"]}


def _solve_captcha(client) -> tuple[str, str]:
    r = client.get("/api/auth/captcha")
    assert r.status_code == 200, f"Captcha failed: {r.status_code}"
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


def auth(token: str) -> dict:
    _ip_counter[0] += 1
    return {
        "Authorization": f"Bearer {token}",
        "X-Forwarded-For": f"10.0.{(_ip_counter[0] >> 8) & 0xFF}.{_ip_counter[0] & 0xFF}",
    }


# в”Ђв”Ђв”Ђ Polls в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


# в”Ђв”Ђв”Ђ Contact Requests в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


class TestContactRequests:
    def test_send_request(self, client, user_a, user_b):
        resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"], "message": "РџСЂРёРІРµС‚!"},
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200, f"Send failed: {resp.status_code} {resp.json()}"
        data = resp.json()
        assert data["from_user_id"] == user_a["id"]
        assert data["to_user_id"] == user_b["id"]
        assert data["status"] == "pending"

    def test_cannot_send_to_self(self, client, user_a):
        resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_a["id"]},
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 400

    def test_cannot_duplicate_request(self, client, user_a, user_b):
        client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 409

    def test_get_incoming(self, client, user_a, user_b):
        client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"], "message": "Hi"},
            headers=auth(user_a["token"]),
        )
        resp = client.get(
            "/api/contacts/requests/incoming",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1
        assert resp.json()[0]["from_user_id"] == user_a["id"]

    def test_get_sent(self, client, user_a, user_b):
        client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        resp = client.get(
            "/api/contacts/requests/sent",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        assert len(resp.json()) == 1

    def test_accept_request(self, client, user_a, user_b):
        create_resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        req_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/contacts/requests/{req_id}/accept",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "accepted"

    def test_reject_request(self, client, user_a, user_b):
        create_resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        req_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/contacts/requests/{req_id}/reject",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 200

    def test_cannot_accept_twice(self, client, user_a, user_b):
        create_resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        req_id = create_resp.json()["id"]

        client.post(
            f"/api/contacts/requests/{req_id}/accept",
            headers=auth(user_b["token"]),
        )
        resp = client.post(
            f"/api/contacts/requests/{req_id}/accept",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 400

    def test_wrong_user_cannot_accept(self, client, user_a, user_b):
        create_resp = client.post(
            "/api/contacts/requests",
            json={"to_user_id": user_b["id"]},
            headers=auth(user_a["token"]),
        )
        req_id = create_resp.json()["id"]

        resp = client.post(
            f"/api/contacts/requests/{req_id}/accept",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 404


# в”Ђв”Ђв”Ђ View-Once Media в”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђв”Ђ


class TestViewOnce:
    def _create_chat(self, client, user_a, user_b) -> str:
        resp = client.post(
            "/api/chat/chats",
            json={"participant_ids": [user_b["id"]]},
            headers=auth(user_a["token"]),
        )
        return resp.json()["id"]

    def test_send_view_once_message(self, client, user_a, user_b):
        chat_id = self._create_chat(client, user_a, user_b)
        resp = client.post(
            f"/api/chat/chats/{chat_id}/messages",
            json={
                "chat_id": chat_id,
                "content": "[encrypted]",
                "message_type": "image",
                "is_view_once": True,
                "encrypted_content": "dGVzdA==",
                "signature": "c2ln",
            },
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200, f"Msg failed: {resp.status_code} {resp.json()}"
        data = resp.json()
        assert data["is_view_once"] is True

    def test_view_once_marks_viewed(self, client, user_a, user_b):
        chat_id = self._create_chat(client, user_a, user_b)
        msg_resp = client.post(
            f"/api/chat/chats/{chat_id}/messages",
            json={
                "chat_id": chat_id,
                "content": "[encrypted]",
                "message_type": "image",
                "is_view_once": True,
                "encrypted_content": "dGVzdA==",
                "signature": "c2ln",
            },
            headers=auth(user_a["token"]),
        )
        msg_id = msg_resp.json()["id"]

        resp = client.post(
            f"/api/chat/messages/{msg_id}/view-once",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 200

    def test_non_participant_cannot_view(self, client, user_a, user_b):
        chat_id = self._create_chat(client, user_a, user_b)
        msg_resp = client.post(
            f"/api/chat/chats/{chat_id}/messages",
            json={
                "chat_id": chat_id,
                "content": "[encrypted]",
                "message_type": "image",
                "is_view_once": True,
                "encrypted_content": "dGVzdA==",
                "signature": "c2ln",
            },
            headers=auth(user_a["token"]),
        )
        msg_id = msg_resp.json()["id"]

        outsider = _register(client, "cc" * 32)
        resp = client.post(
            f"/api/chat/messages/{msg_id}/view-once",
            headers=auth(outsider["token"]),
        )
        assert resp.status_code in (403, 404)


@pytest.fixture
def user_a(client):
    return _register(client, "aa" * 32)


@pytest.fixture
def user_b(client):
    return _register(client, "bb" * 32)
