"""Group forward secrecy at the system level: membership change wipes the
wrapped group key, removed members lose access, only the creator re-inits.

Crypto primitives are covered in test_group_e2e.py; this covers the
server endpoints' contract (contacts_groups wipe + chat.py creator rule).
"""
import pytest
from fastapi.testclient import TestClient

from server.main import app
from shared.rate_limiter import limiter
from test.conftest import TURNSTILE_TEST_TOKEN

client = TestClient(app)


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()


def _csrf_headers() -> dict:
    r = client.get("/health")
    return {"X-CSRF-Token": r.cookies.get("csrf_token", "")}


def _register(username: str) -> dict:
    r = client.post("/api/auth/register", json={
        "username": username, "password": "TestPass123",
        "first_name": "Test", "public_key": "a" * 64,
        "signing_public_key": "b" * 64,
        "turnstile_token": TURNSTILE_TEST_TOKEN,
    }, headers=_csrf_headers())
    assert r.status_code == 200, r.text
    return r.json()


def _h(data: dict) -> dict:
    return {"Authorization": f"Bearer {data['access_token']}", **_csrf_headers()}


class TestGroupRekey:
    def test_remove_wipes_key_and_creator_reinits(self):
        admin = _register("rekeyadmin")
        member = _register("rekeymember")
        ha, hm = _h(admin), _h(member)
        auid, muid = admin["user"]["id"], member["user"]["id"]

        r = client.post("/api/chat/chats", json={
            "name": "G", "participant_ids": [muid], "is_group": True,
        }, headers=ha)
        assert r.status_code == 200, r.text
        gid = r.json()["id"]

        # Admin distributes wrapped key to both.
        r = client.post(f"/api/chat/chats/{gid}/group-key",
                        json={"encrypted_keys": {auid: "sealedA", muid: "sealedB"}},
                        headers=ha)
        assert r.status_code == 200, r.text
        r = client.get(f"/api/chat/chats/{gid}/group-key", headers=hm)
        assert r.status_code == 200 and r.json()["encrypted_key"] == "sealedB"

        # Admin removes member → key wiped for everyone, member cut off.
        r = client.delete(f"/api/contacts-groups/groups/{gid}/participants/{muid}",
                          headers=ha)
        assert r.status_code == 200, r.text
        assert client.get(f"/api/chat/chats/{gid}/group-key", headers=ha).status_code == 404
        assert client.get(f"/api/chat/chats/{gid}/group-key", headers=hm).status_code == 403

        # Admin re-inits for remaining members; old sealed copies are dead.
        r = client.post(f"/api/chat/chats/{gid}/group-key",
                        json={"encrypted_keys": {auid: "sealedA2"}}, headers=ha)
        assert r.status_code == 200, r.text
        r = client.get(f"/api/chat/chats/{gid}/group-key", headers=ha)
        assert r.status_code == 200 and r.json()["encrypted_key"] == "sealedA2"

        # Re-added member cannot hijack the creator slot: re-adding wipes
        # the key again, admin re-inits, then member overwrite is 403.
        r = client.post(f"/api/contacts-groups/groups/{gid}/participants/{muid}",
                        headers=ha)
        assert r.status_code == 200, r.text
        r = client.post(f"/api/chat/chats/{gid}/group-key",
                        json={"encrypted_keys": {auid: "sealedA3", muid: "sealedB3"}},
                        headers=ha)
        assert r.status_code == 200, r.text
        r = client.post(f"/api/chat/chats/{gid}/group-key",
                        json={"encrypted_keys": {muid: "evil"}}, headers=hm)
        assert r.status_code == 403, r.text

    def test_leave_wipes_key(self):
        admin = _register("leaveadmin")
        member = _register("leavemember")
        ha, hm = _h(admin), _h(member)
        auid = admin["user"]["id"]
        muid = member["user"]["id"]

        r = client.post("/api/chat/chats", json={
            "name": "G2", "participant_ids": [muid], "is_group": True,
        }, headers=ha)
        gid = r.json()["id"]
        r = client.post(f"/api/chat/chats/{gid}/group-key",
                        json={"encrypted_keys": {auid: "s1", muid: "s2"}}, headers=ha)
        assert r.status_code == 200, r.text

        r = client.post(f"/api/contacts-groups/groups/{gid}/leave", headers=hm)
        assert r.status_code == 200, r.text
        assert client.get(f"/api/chat/chats/{gid}/group-key", headers=ha).status_code == 404
