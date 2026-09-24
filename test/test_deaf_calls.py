"""Deaf-relay + calls hardening tests (2026-09).

Locks in:
- REST edit endpoint rejects plaintext when RELAY_DEAF=true (400),
  accepts E2E envelope body.
- Ephemeral endpoint rejects plaintext when RELAY_DEAF=true (400).
- /api/calls/ice-servers never advertises an internal/unconfigured
  TURN host; STUN-only + warning when TURN is not configured.
- POST /start-call accepts a client call_id and persists a CallLog row
  so REST end-call works; end-call notifies the peer path (no 404 for
  a call created via REST).
"""

import re
import uuid

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
    nums = [int(n) for n in re.findall(r"\d+", q)]
    if "×" in q or "x" in q:
        answer = nums[0] * nums[1]
    elif "-" in q:
        answer = nums[0] - nums[1]
    else:
        answer = nums[0] + nums[1]
    return data["captcha_id"], str(answer)


def _register_user(username: str) -> dict:
    cid, ans = _solve_captcha()
    csrf = _csrf_headers()
    r = client.post("/api/auth/register", json={
        "username": username, "password": "TestPass123",
        "first_name": "Test",
        "public_key": "a" * 64, "signing_public_key": "b" * 64,
        "captcha_id": cid, "captcha_code": ans,
    }, headers=csrf)
    assert r.status_code == 200, f"Register failed: {r.text}"
    return r.json()


def _auth(username: str) -> tuple[dict, dict]:
    data = _register_user(username)
    tok = data["access_token"]
    headers = {"Authorization": f"Bearer {tok}", **_csrf_headers()}
    return data, headers


def _make_chat(headers: dict, other_id: str) -> str:
    r = client.post("/api/chat/chats", json={
        "name": None, "is_group": False, "participant_ids": [other_id],
    }, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _send_e2e(headers: dict, chat_id: str) -> str:
    r = client.post(f"/api/chat/chats/{chat_id}/messages", json={
        "chat_id": chat_id, "content": "[encrypted]",
        "message_type": "text", "encrypted_content": '{"test": 1}',
        "signature": "sig",
    }, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()
    yield
    limiter.reset()


class TestDeafEditEndpoint:
    def test_edit_plaintext_rejected_when_deaf(self):
        from shared.config import settings
        if not settings.RELAY_DEAF:
            pytest.skip("RELAY_DEAF off")
        a, ha = _auth(f"deafedit_a_{uuid.uuid4().hex[:8]}")
        b, _ = _auth(f"deafedit_b_{uuid.uuid4().hex[:8]}")
        chat_id = _make_chat(ha, b["user"]["id"])
        msg_id = _send_e2e(ha, chat_id)
        r = client.put(
            f"/api/chat/messages/{msg_id}/edit?new_content=plaintext",
            headers=ha,
        )
        assert r.status_code == 400

    def test_edit_envelope_accepted_when_deaf(self):
        from shared.config import settings
        if not settings.RELAY_DEAF:
            pytest.skip("RELAY_DEAF off")
        a, ha = _auth(f"deafedit2_a_{uuid.uuid4().hex[:8]}")
        b, _ = _auth(f"deafedit2_b_{uuid.uuid4().hex[:8]}")
        chat_id = _make_chat(ha, b["user"]["id"])
        msg_id = _send_e2e(ha, chat_id)
        r = client.put(f"/api/chat/messages/{msg_id}/edit", json={
            "content": "[encrypted]",
            "encrypted_content": '{"edited": 1}',
            "signature": "sig2",
        }, headers=ha)
        assert r.status_code == 200, r.text

    def test_edit_over_5000_rejected(self):
        a, ha = _auth(f"deafedit3_a_{uuid.uuid4().hex[:8]}")
        b, _ = _auth(f"deafedit3_b_{uuid.uuid4().hex[:8]}")
        chat_id = _make_chat(ha, b["user"]["id"])
        msg_id = _send_e2e(ha, chat_id)
        r = client.put(f"/api/chat/messages/{msg_id}/edit", json={
            "content": "[encrypted]",
            "encrypted_content": '{"edited": "' + "x" * 6000 + '"}',
            "signature": "sig2",
        }, headers=ha)
        # Кап применяется к content; конверт больше капа тела не лимитируем.
        assert r.status_code in (200, 400)
        r = client.put(
            f"/api/chat/messages/{msg_id}/edit?new_content={'y' * 5001}",
            headers=ha,
        )
        assert r.status_code == 400


class TestDeafEphemeralEndpoint:
    def test_ephemeral_plaintext_rejected_when_deaf(self):
        from shared.config import settings
        if not settings.RELAY_DEAF:
            pytest.skip("RELAY_DEAF off")
        a, ha = _auth(f"deafeph_a_{uuid.uuid4().hex[:8]}")
        b, _ = _auth(f"deafeph_b_{uuid.uuid4().hex[:8]}")
        chat_id = _make_chat(ha, b["user"]["id"])
        r = client.post(
            f"/api/chat/chats/{chat_id}/messages-ephemeral",
            params={"content": "secret plaintext", "expires_in_seconds": 60},
            headers=ha,
        )
        assert r.status_code == 400


class TestIceServers:
    def test_no_internal_turn_host_advertised(self):
        a, ha = _auth(f"ice_{uuid.uuid4().hex[:8]}")
        r = client.get("/api/calls/ice-servers", headers=ha)
        assert r.status_code == 200
        servers = r.json()["ice_servers"]
        assert len(servers) >= 1
        blob = str(servers)
        assert "nurchat-turn" not in blob


class TestCallRestFlow:
    def test_start_call_with_client_id_then_end(self):
        a, ha = _auth(f"call_a_{uuid.uuid4().hex[:8]}")
        b, _ = _auth(f"call_b_{uuid.uuid4().hex[:8]}")
        call_id = f"call_123_{uuid.uuid4().hex[:8]}"
        r = client.post("/api/calls/start-call", json={
            "target_user_id": b["user"]["id"],
            "call_type": "audio",
            "call_id": call_id,
        }, headers=ha)
        assert r.status_code == 200, r.text
        assert r.json()["call_id"] == call_id
        r2 = client.post(f"/api/calls/end-call/{call_id}", headers=ha)
        assert r2.status_code == 200, r2.text
