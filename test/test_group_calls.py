"""Integration tests for group calls."""
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

_ip_counter = [0]


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

    from slowapi import Limiter
    from slowapi.util import get_remote_address

    from shared.rate_limiter import limiter
    limiter.__dict__.update(Limiter(key_func=get_remote_address).__dict__)

    yield

    Base.metadata.drop_all(bind=engine)
    engine.dispose()
    db_module.engine = old_engine
    db_module.SessionLocal = old_session


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


def _register(client, public_key: str = "pk_test_key") -> dict:
    _ip_counter[0] += 1
    ip = f"10.0.0.{_ip_counter[0]}"
    resp = client.post(
        "/api/auth/anonymous",
        json={"public_key": public_key},
        headers={"X-Forwarded-For": ip},
    )
    assert resp.status_code == 200, f"Register failed: {resp.status_code} {resp.json()}"
    data = resp.json()
    return {"id": data["user"]["id"], "token": data["access_token"]}


def auth(token: str) -> dict:
    _ip_counter[0] += 1
    return {
        "Authorization": f"Bearer {token}",
        "X-Forwarded-For": f"10.0.{(_ip_counter[0] >> 8) & 0xFF}.{_ip_counter[0] & 0xFF}",
    }


def _create_group_chat(client, user_a, user_b) -> str:
    resp = client.post(
        "/api/chat/chats",
        json={"name": "Группа", "participant_ids": [user_b["id"]], "is_group": True},
        headers=auth(user_a["token"]),
    )
    assert resp.status_code == 200, f"Chat create failed: {resp.json()}"
    return resp.json()["id"]


@pytest.fixture
def user_a(client):
    return _register(client, "pk_user_a_key")


@pytest.fixture
def user_b(client):
    return _register(client, "pk_user_b_key")


@pytest.fixture
def user_c(client):
    return _register(client, "pk_user_c_key")


class TestGroupCalls:
    def test_start_group_call(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "video"},
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["call_id"]
        assert data["chat_id"] == chat_id
        assert data["created_by"] == user_a["id"]
        assert data["call_type"] == "video"
        assert data["participant_count"] == 1

    def test_join_group_call(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        call_id = resp.json()["call_id"]

        resp = client.post(
            f"/api/group-calls/join/{call_id}",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["participant_count"] == 2

    def test_leave_group_call(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        call_id = resp.json()["call_id"]

        client.post(
            f"/api/group-calls/join/{call_id}",
            headers=auth(user_b["token"]),
        )

        resp = client.post(
            f"/api/group-calls/leave/{call_id}",
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["remaining"] == 1

    def test_end_group_call(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        call_id = resp.json()["call_id"]

        resp = client.post(
            f"/api/group-calls/end/{call_id}",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200

        resp = client.get(
            f"/api/group-calls/active/{chat_id}",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() is None

    def test_cannot_start_duplicate(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "video"},
            headers=auth(user_b["token"]),
        )
        assert resp.status_code == 409

    def test_non_participant_cannot_join(self, client, user_a, user_b, user_c):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        call_id = resp.json()["call_id"]

        resp = client.post(
            f"/api/group-calls/join/{call_id}",
            headers=auth(user_c["token"]),
        )
        assert resp.status_code == 403

    def test_toggle_mute(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        call_id = resp.json()["call_id"]

        resp = client.post(
            f"/api/group-calls/toggle-mute/{call_id}",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_muted"] is True

    def test_toggle_video(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "video"},
            headers=auth(user_a["token"]),
        )
        call_id = resp.json()["call_id"]

        resp = client.post(
            f"/api/group-calls/toggle-video/{call_id}",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json()["is_video_off"] is True

    def test_get_active_call(self, client, user_a, user_b):
        chat_id = _create_group_chat(client, user_a, user_b)
        resp = client.get(
            f"/api/group-calls/active/{chat_id}",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() is None

        client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        resp = client.get(
            f"/api/group-calls/active/{chat_id}",
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 200
        assert resp.json() is not None

    def test_cannot_start_in_dm(self, client, user_a, user_b):
        resp = client.post(
            "/api/chat/chats",
            json={"participant_ids": [user_b["id"]], "is_group": False},
            headers=auth(user_a["token"]),
        )
        chat_id = resp.json()["id"]

        resp = client.post(
            "/api/group-calls/start",
            json={"chat_id": chat_id, "call_type": "audio"},
            headers=auth(user_a["token"]),
        )
        assert resp.status_code == 400
        assert "группов" in resp.json()["detail"].lower()
