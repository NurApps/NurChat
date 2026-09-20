"""E2E reactions: relay stores blinded tag + ciphertext, never plaintext emoji."""
import pytest
from fastapi.testclient import TestClient

from server.main import app
from shared.rate_limiter import limiter
from test.test_api import _csrf_headers, _register_user, _solve_captcha  # noqa: F401  (helpers reuse)

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()


@pytest.fixture(autouse=True)
def _clear_db():
    from server.core import models
    from server.core.database import SessionLocal
    db = SessionLocal()
    try:
        for table in [models.MessageReaction, models.MessageReadStatus, models.Message,
                      models.ChatParticipant, models.Chat, models.User]:
            db.query(table).delete()
        db.commit()
    finally:
        db.close()


def _two_users_in_chat():
    u1 = _register_user()
    u2 = _register_user("ruser2", "Pass1234", "Second")
    h1 = {"Authorization": f"Bearer {u1['access_token']}", **_csrf_headers()}
    r = client.post("/api/chat/chats", json={
        "name": "Chat", "participant_ids": [u2["user"]["id"]], "is_group": False,
    }, headers=h1)
    assert r.status_code == 200, r.text
    chat_id = r.json()["id"]
    r = client.post(f"/api/chat/chats/{chat_id}/messages", json={
        "chat_id": chat_id, "content": "[encrypted]", "message_type": "text",
        "encrypted_content": "dGVzdA==", "signature": "c2ln",
    }, headers=h1)
    assert r.status_code == 200, r.text
    return u1, u2, h1, chat_id, r.json()["id"]


class TestE2EReactions:
    def test_toggle_stores_tag_not_emoji(self):
        u1, u2, h1, chat_id, msg_id = _two_users_in_chat()
        tag = "ab" * 32  # blinded HMAC hex in production
        r = client.post(f"/api/chat/messages/{msg_id}/react", json={
            "tag": tag, "enc_emoji": "ZW5jcnlwdGVkLWVtb2pp",
        }, headers=h1)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert len(rows) == 1
        assert rows[0]["tag"] == tag
        assert rows[0]["enc_emoji"] == "ZW5jcnlwdGVkLWVtb2pp"
        assert rows[0]["emoji"] is None
        assert rows[0]["user_id"] == u1["user"]["id"]

        # Toggle again with the same tag removes it (server never decrypts).
        r = client.post(f"/api/chat/messages/{msg_id}/react", json={
            "tag": tag, "enc_emoji": "ZW5jcnlwdGVkLWVtb2pp",
        }, headers=h1)
        assert r.status_code == 200, r.text
        assert r.json() == []

    def test_history_returns_rows_not_grouped_map(self):
        u1, u2, h1, chat_id, msg_id = _two_users_in_chat()
        client.post(f"/api/chat/messages/{msg_id}/react", json={
            "tag": "cc" * 32, "enc_emoji": "ZW5j",
        }, headers=h1)
        r = client.get(f"/api/chat/chats/{chat_id}/messages", headers=h1)
        assert r.status_code == 200
        msg = next(m for m in r.json() if m["id"] == msg_id)
        assert isinstance(msg["reactions"], list)
        assert msg["reactions"][0]["tag"] == "cc" * 32
        assert "emoji" not in msg["reactions"][0] or msg["reactions"][0]["emoji"] is None

    def test_legacy_plaintext_row_still_readable(self):
        """Pre-E2E rows (emoji set, no tag) survive the nullable migration."""
        from server.core import models
        from server.core.database import SessionLocal
        u1, u2, h1, chat_id, msg_id = _two_users_in_chat()
        db = SessionLocal()
        try:
            db.add(models.MessageReaction(
                message_id=msg_id, user_id=u1["user"]["id"], emoji="👍"))
            db.commit()
        finally:
            db.close()
        r = client.get(f"/api/chat/chats/{chat_id}/messages", headers=h1)
        assert r.status_code == 200
        msg = next(m for m in r.json() if m["id"] == msg_id)
        assert msg["reactions"][0]["emoji"] == "👍"

    def test_react_requires_auth_and_membership(self):
        u1, u2, h1, chat_id, msg_id = _two_users_in_chat()
        # No token → 401/403, not 500.
        r = client.post(f"/api/chat/messages/{msg_id}/react", json={
            "tag": "dd" * 32, "enc_emoji": "eA==",
        })
        assert r.status_code in (401, 403)
        # Outsider (third user, not a participant) → 403.
        u3 = _register_user("ruser3", "Pass1234", "Third")
        h3 = {"Authorization": f"Bearer {u3['access_token']}", **_csrf_headers()}
        r = client.post(f"/api/chat/messages/{msg_id}/react", json={
            "tag": "dd" * 32, "enc_emoji": "eA==",
        }, headers=h3)
        assert r.status_code == 403
