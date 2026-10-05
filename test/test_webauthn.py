"""Passkeys (WebAuthn): options -> verify, счётчик, replay-защита, origin/rp_id."""

import pytest
from fastapi.testclient import TestClient

from server.main import app
from server.routes import webauthn as webauthn_route
from shared.rate_limiter import limiter
from test.conftest import TURNSTILE_TEST_TOKEN

client = TestClient(app)

ORIGIN = "http://localhost:5173"


def _csrf() -> dict:
    r = client.get("/health")
    return {"X-CSRF-Token": r.cookies.get("csrf_token", "")}


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    webauthn_route._challenges.clear()
    from server.core import models
    from server.core.database import SessionLocal
    db = SessionLocal()
    try:
        for table in [models.WebAuthnCredential, models.MessageReadStatus, models.Message,
                      models.ChatParticipant, models.Chat, models.User]:
            db.query(table).delete()
        db.commit()
    finally:
        db.close()


def _register(username: str) -> dict:
    r = client.post("/api/auth/register", json={
        "username": username, "password": "TestPass123", "first_name": "Tst",
        "public_key": "a" * 64, "signing_public_key": "b" * 64,
        "turnstile_token": TURNSTILE_TEST_TOKEN,
    }, headers=_csrf())
    assert r.status_code == 200, r.text
    return r.json()


class _FakeReg:
    credential_id = b"cred-id-1"
    credential_public_key = b"fake-pubkey"
    sign_count = 0


class _FakeAuth:
    def __init__(self, new_sign_count: int = 1):
        self.new_sign_count = new_sign_count


def _auth_headers(token: str) -> dict:
    return {**_csrf(), "Authorization": f"Bearer {token}"}


def _bind_passkey(monkeypatch, token: str, sign_count: int = 0) -> dict:
    """Полная привязка с мокнутой проверкой attestation."""
    monkeypatch.setattr(
        webauthn_route.webauthn, "verify_registration_response",
        lambda **kw: _FakeReg(),
    )
    r = client.post("/api/webauthn/register/options",
                    json={"origin": ORIGIN}, headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    r = client.post("/api/webauthn/register/verify", json={
        "credential": {"id": "x", "rawId": "x", "response": {}, "type": "public-key"},
        "origin": ORIGIN, "name": "Test Key",
    }, headers=_auth_headers(token))
    assert r.status_code == 200, r.text
    return r.json()["credential"]


class TestPasskeyRegistration:
    def test_options_require_auth(self):
        r = client.post("/api/webauthn/register/options", json={"origin": ORIGIN})
        assert r.status_code in (401, 403)

    def test_options_reject_bad_origin(self):
        reg = _register("wn_bad_origin")
        r = client.post("/api/webauthn/register/options",
                        json={"origin": "https://evil.example.com"},
                        headers=_auth_headers(reg["access_token"]))
        assert r.status_code == 400

    def test_challenge_is_single_use(self, monkeypatch):
        reg = _register("wn_replay")
        monkeypatch.setattr(
            webauthn_route.webauthn, "verify_registration_response",
            lambda **kw: _FakeReg(),
        )
        h = _auth_headers(reg["access_token"])
        client.post("/api/webauthn/register/options", json={"origin": ORIGIN}, headers=h)
        body = {"credential": {"id": "x"}, "origin": ORIGIN, "name": ""}
        assert client.post("/api/webauthn/register/verify", json=body, headers=h).status_code == 200
        # Тот же options уже погашен take_challenge — новый нужен заново.
        assert client.post("/api/webauthn/register/verify", json=body, headers=h).status_code == 400

    def test_duplicate_credential_rejected(self, monkeypatch):
        reg = _register("wn_dup")
        _bind_passkey(monkeypatch, reg["access_token"])
        monkeypatch.setattr(
            webauthn_route.webauthn, "verify_registration_response",
            lambda **kw: _FakeReg(),
        )
        h = _auth_headers(reg["access_token"])
        client.post("/api/webauthn/register/options", json={"origin": ORIGIN}, headers=h)
        r = client.post("/api/webauthn/register/verify", json={
            "credential": {"id": "x"}, "origin": ORIGIN, "name": "",
        }, headers=h)
        assert r.status_code == 400


class TestPasskeyLogin:
    def test_unknown_user_not_leaked(self):
        r = client.post("/api/webauthn/login/options",
                        json={"username": "no_such_user", "origin": ORIGIN})
        assert r.status_code == 400
        assert "Passkey-вход недоступен" in r.text

    def test_full_login_cycle(self, monkeypatch):
        reg = _register("wn_login")
        _bind_passkey(monkeypatch, reg["access_token"])
        monkeypatch.setattr(
            webauthn_route.webauthn, "verify_authentication_response",
            lambda **kw: _FakeAuth(new_sign_count=1),
        )
        r = client.post("/api/webauthn/login/options",
                        json={"username": "wn_login", "origin": ORIGIN})
        assert r.status_code == 200, r.text
        r = client.post("/api/webauthn/login/verify", json={
            "username": "wn_login",
            "credential": {"id": "Y3JlZC1pZC0x", "rawId": "Y3JlZC1pZC0x",
                           "response": {}, "type": "public-key"},
            "origin": ORIGIN,
        })
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["access_token"]
        assert body["requires_2fa"] is False
        me = client.get("/api/auth/me",
                        headers={"Authorization": f"Bearer {body['access_token']}"})
        assert me.status_code == 200

    def test_stale_sign_count_rejected(self, monkeypatch):
        reg = _register("wn_clone")
        _bind_passkey(monkeypatch, reg["access_token"])
        body = {
            "username": "wn_clone",
            "credential": {"id": "Y3JlZC1pZC0x", "rawId": "Y3JlZC1pZC0x",
                           "response": {}, "type": "public-key"},
            "origin": ORIGIN,
        }
        # Первый вход двигает счётчик 0→1.
        monkeypatch.setattr(
            webauthn_route.webauthn, "verify_authentication_response",
            lambda **kw: _FakeAuth(new_sign_count=1),
        )
        client.post("/api/webauthn/login/options",
                    json={"username": "wn_clone", "origin": ORIGIN})
        r = client.post("/api/webauthn/login/verify", json=body)
        assert r.status_code == 200, r.text
        # Повтор со старым счётчиком (replay/клон) — 401.
        client.post("/api/webauthn/login/options",
                    json={"username": "wn_clone", "origin": ORIGIN})
        r = client.post("/api/webauthn/login/verify", json=body)
        assert r.status_code == 401

    def test_zero_counter_devices_tolerated(self, monkeypatch):
        reg = _register("wn_nocounter")
        _bind_passkey(monkeypatch, reg["access_token"])
        monkeypatch.setattr(
            webauthn_route.webauthn, "verify_authentication_response",
            lambda **kw: _FakeAuth(new_sign_count=0),
        )
        body = {
            "username": "wn_nocounter",
            "credential": {"id": "Y3JlZC1pZC0x", "rawId": "Y3JlZC1pZC0x",
                           "response": {}, "type": "public-key"},
            "origin": ORIGIN,
        }
        for _ in range(2):
            client.post("/api/webauthn/login/options",
                        json={"username": "wn_nocounter", "origin": ORIGIN})
            r = client.post("/api/webauthn/login/verify", json=body)
            assert r.status_code == 200, r.text


class TestPasskeyManagement:
    def test_list_rename_delete(self, monkeypatch):
        reg = _register("wn_mgmt")
        h = _auth_headers(reg["access_token"])
        cred = _bind_passkey(monkeypatch, reg["access_token"])
        r = client.get("/api/webauthn/credentials", headers=h)
        assert r.status_code == 200
        assert len(r.json()["credentials"]) == 1

        r = client.patch(f"/api/webauthn/credentials/{cred['id']}",
                         json={"name": "YubiKey"}, headers=h)
        assert r.status_code == 200
        assert r.json()["credential"]["name"] == "YubiKey"

        # Удаление без пароля — 401/422, с неверным — 401.
        r = client.request("DELETE", f"/api/webauthn/credentials/{cred['id']}", headers=h)
        assert r.status_code == 422
        r = client.request("DELETE", f"/api/webauthn/credentials/{cred['id']}",
                           json={"password": "WrongPass123"}, headers=h)
        assert r.status_code == 401

        r = client.request("DELETE", f"/api/webauthn/credentials/{cred['id']}",
                           json={"password": "TestPass123"}, headers=h)
        assert r.status_code == 200
        r = client.get("/api/webauthn/credentials", headers=h)
        assert r.json()["credentials"] == []
