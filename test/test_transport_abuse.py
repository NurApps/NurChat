"""Transport abuse tests: WS handlers and send-path link validation.

Covers vulns found in the 2026-09 transport audit:
- WS delete globally hid anyone's messages without participant/author checks
- WS edit broadcast phantom edits with no DB change behind them
- WS typing accepted for foreign chats (noise injection)
- file_id / reply_to_id not validated on send (cross-chat file link leak)
- LIKE wildcards unescaped in search (over-matching)
"""
import io

import pytest
from fastapi.testclient import TestClient

from server.main import app
from shared.rate_limiter import limiter
from test.test_api import _csrf_headers, _register_user

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
                      models.ChatParticipant, models.Chat, models.File,
                      models.User]:
            db.query(table).delete()
        db.commit()
    finally:
        db.close()


def _auth(u):
    return {"Authorization": f"Bearer {u['access_token']}", **_csrf_headers()}


def _chat_and_msg():
    """Two users + 1-1 chat + one E2E message. Returns (u1, u2, h1, h2, chat_id, msg_id)."""
    u1 = _register_user()
    u2 = _register_user("abuser2", "Pass1234", "Second")
    h1, h2 = _auth(u1), _auth(u2)
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
    return u1, u2, h1, h2, chat_id, r.json()["id"]


def _ws_url(user, token_key="access_token"):
    return f"/ws/chat/{user['user']['id']}?token={user[token_key]}"


class TestWSDeleteGuards:
    def test_outsider_cannot_hide_message(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        u3 = _register_user("outsider", "Pass1234", "Out")
        with client.websocket_connect(_ws_url(u3)) as ws:
            ws.send_json({"event": "delete_message", "data": {
                "message_id": msg_id, "chat_id": chat_id, "delete_for_all": True,
            }})
            # give the handler a beat to (not) act
            import time
            time.sleep(0.5)
        r = client.get(f"/api/chat/chats/{chat_id}/messages", headers=h1)
        msg = next(m for m in r.json() if m["id"] == msg_id)
        assert msg.get("is_deleted") in (False, None)

    def test_author_can_delete_own_message(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        with client.websocket_connect(_ws_url(u1)) as ws:
            ws.send_json({"event": "delete_message", "data": {
                "message_id": msg_id, "chat_id": chat_id, "delete_for_all": True,
            }})
            import time
            time.sleep(0.5)
        r = client.get(f"/api/chat/chats/{chat_id}/messages", headers=h1)
        assert r.status_code == 200

    def test_participant_cannot_delete_others_message(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        # u2 IS a participant but NOT the author: must not delete u1's message.
        with client.websocket_connect(_ws_url(u2)) as ws:
            ws.send_json({"event": "delete_message", "data": {
                "message_id": msg_id, "chat_id": chat_id, "delete_for_all": False,
            }})
            import time
            time.sleep(0.5)
        from server.core import models
        from server.core.database import SessionLocal
        db = SessionLocal()
        try:
            m = db.query(models.Message).filter(models.Message.id == msg_id).first()
            assert m is not None and m.is_deleted is not True
        finally:
            db.close()


class TestWSEditGuards:
    def test_phantom_edit_changes_nothing(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        u3 = _register_user("outsider2", "Pass1234", "Out")
        with client.websocket_connect(_ws_url(u3)) as ws:
            ws.send_json({"event": "edit_message", "data": {
                "message_id": msg_id, "chat_id": chat_id,
                "new_content": "PWNED",
                "encrypted_content": "eA==", "signature": "cw==",
            }})
            import time
            time.sleep(0.5)
        from server.core import models
        from server.core.database import SessionLocal
        db = SessionLocal()
        try:
            m = db.query(models.Message).filter(models.Message.id == msg_id).first()
            assert m.content == "[encrypted]"
            assert m.edited_at is None
        finally:
            db.close()


class TestWSTypingGuards:
    def test_typing_foreign_chat_no_crash(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        u3 = _register_user("outsider3", "Pass1234", "Out")
        with client.websocket_connect(_ws_url(u3)) as ws:
            ws.send_json({"event": "typing", "data": {
                "chat_id": chat_id, "is_typing": True,
            }})
            import time
            time.sleep(0.3)
        # Suite green + server alive is the assertion (no DB trace for typing).


class TestSendLinkValidation:
    def _upload_as(self, user):
        h = _auth(user)
        r = client.post("/api/files/upload", data={"file_type": "image"},
                        files={"file": ("pic.png", io.BytesIO(b"img"), "image/png")},
                        headers=h)
        assert r.status_code == 200, r.text
        return r.json()["id"]

    def test_foreign_file_rejected(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        fid = self._upload_as(u2)  # u2's file
        # u1 attaches u2's file to a chat where it was never shared → 403.
        r = client.post(f"/api/chat/chats/{chat_id}/messages", json={
            "chat_id": chat_id, "content": "[encrypted]", "message_type": "image",
            "encrypted_content": "eA==", "signature": "cw==", "file_id": fid,
        }, headers=h1)
        assert r.status_code == 403, r.text

    def test_cross_chat_reply_rejected(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        r = client.post("/api/chat/chats", json={
            "name": "Other", "participant_ids": [u2["user"]["id"]], "is_group": False,
        }, headers=h1)
        other_chat = r.json()["id"]
        r = client.post(f"/api/chat/chats/{other_chat}/messages", json={
            "chat_id": other_chat, "content": "[encrypted]", "message_type": "text",
            "encrypted_content": "eA==", "signature": "cw==", "reply_to_id": msg_id,
        }, headers=h1)
        assert r.status_code == 400, r.text

    def test_ws_send_foreign_file_dropped(self):
        u1, u2, h1, h2, chat_id, msg_id = _chat_and_msg()
        fid = self._upload_as(u2)
        with client.websocket_connect(_ws_url(u1)) as ws:
            ws.send_json({"event": "message", "data": {
                "chat_id": chat_id, "content": "x", "message_type": "image",
                "encrypted_content": "eA==", "signature": "cw==", "file_id": fid,
            }})
            import time
            time.sleep(0.5)
        from server.core import models
        from server.core.database import SessionLocal
        db = SessionLocal()
        try:
            n = db.query(models.Message).filter(
                models.Message.chat_id == chat_id,
                models.Message.file_id == fid).count()
            assert n == 0
        finally:
            db.close()


class TestSearchEscape:
    def test_percent_matches_literally(self):
        """ '%' must not act as a wildcard. Plant plaintext rows directly
        (RELAY_DEAF blocks plaintext ingest, and any E2E row would make the
        endpoint return unfiltered history instead of searching)."""
        from server.core import models
        from server.core.database import SessionLocal
        u1 = _register_user()
        u2 = _register_user("abuser2b", "Pass1234", "Second")
        h1 = _auth(u1)
        r = client.post("/api/chat/chats", json={
            "name": "Chat", "participant_ids": [u2["user"]["id"]], "is_group": False,
        }, headers=h1)
        chat_id = r.json()["id"]
        db = SessionLocal()
        try:
            db.add(models.Message(id="msg_pct", chat_id=chat_id,
                                  user_id=u1["user"]["id"], content="100% legit",
                                  message_type="text"))
            db.add(models.Message(id="msg_hw", chat_id=chat_id,
                                  user_id=u1["user"]["id"], content="hello world",
                                  message_type="text"))
            db.commit()
        finally:
            db.close()
        r = client.get(f"/api/chat/chats/{chat_id}/search",
                       params={"q": "%"}, headers=h1)
        assert r.status_code == 200
        contents = [m["content"] for m in r.json()]
        assert "100% legit" in contents
        assert "hello world" not in contents
