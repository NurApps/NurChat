"""Invite-only registration (host mode): fail-closed, constant-time code check."""

import pytest
from fastapi.testclient import TestClient

from server.main import app
from shared.config import settings
from shared.rate_limiter import limiter
from test.conftest import TURNSTILE_TEST_TOKEN

client = TestClient(app)


def _csrf_headers() -> dict:
    r = client.get("/health")
    return {"X-CSRF-Token": r.cookies.get("csrf_token", "")}


def _payload(username: str, invite_code: str | None = None) -> dict:
    body = {
        "username": username,
        "password": "TestPass123",
        "first_name": "Test",
        "public_key": "a" * 64,
        "signing_public_key": "b" * 64,
        "turnstile_token": TURNSTILE_TEST_TOKEN,
    }
    if invite_code is not None:
        body["invite_code"] = invite_code
    return body


@pytest.fixture(autouse=True)
def _invite_mode(monkeypatch):
    limiter.reset()
    original_mode = settings.REGISTRATION_MODE
    original_code = settings.REGISTRATION_INVITE_CODE
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "invite")
    monkeypatch.setattr(settings, "REGISTRATION_INVITE_CODE", "test-invite-code")
    yield
    # Эндпоинты хост-режима меняют settings напрямую, не через monkeypatch.
    settings.REGISTRATION_MODE = original_mode
    settings.REGISTRATION_INVITE_CODE = original_code
    limiter.reset()


def test_policy_endpoint_reports_invite():
    r = client.get("/api/auth/policy")
    assert r.status_code == 200
    assert r.json()["registration_mode"] == "invite"


def test_register_without_code_is_forbidden():
    r = client.post("/api/auth/register", json=_payload("invite_none"), headers=_csrf_headers())
    assert r.status_code == 403


def test_register_with_wrong_code_is_forbidden():
    r = client.post(
        "/api/auth/register",
        json=_payload("invite_bad", "nope"),
        headers=_csrf_headers(),
    )
    assert r.status_code == 403


def test_register_with_correct_code_succeeds():
    r = client.post(
        "/api/auth/register",
        json=_payload("invite_ok", "test-invite-code"),
        headers=_csrf_headers(),
    )
    assert r.status_code == 200, r.text
    assert r.json()["user"]["username"] == "invite_ok"


def test_open_mode_allows_missing_code(monkeypatch):
    monkeypatch.setattr(settings, "REGISTRATION_MODE", "open")
    r = client.post("/api/auth/register", json=_payload("invite_open"), headers=_csrf_headers())
    assert r.status_code == 200, r.text


def test_empty_expected_code_fails_closed(monkeypatch):
    monkeypatch.setattr(settings, "REGISTRATION_INVITE_CODE", "")
    r = client.post(
        "/api/auth/register",
        json=_payload("invite_empty", ""),
        headers=_csrf_headers(),
    )
    assert r.status_code == 403


class TestHostConfigEndpoint:
    """Админ-эндпоинты хост-режима: только loopback без прокси-заголовков."""

    def test_loopback_is_allowed(self):
        local = TestClient(app, client=("127.0.0.1", 5555))
        r = local.get("/api/host/config")
        assert r.status_code == 200
        assert "invite_only" in r.json()

    def test_non_loopback_is_hidden(self):
        r = client.get("/api/host/config")
        assert r.status_code == 404

    def test_proxied_loopback_is_hidden(self):
        local = TestClient(app, client=("127.0.0.1", 5555))
        r = local.get("/api/host/config", headers={"X-Forwarded-For": "203.0.113.5"})
        assert r.status_code == 404

    def test_invite_enable_generates_code(self, monkeypatch, tmp_path):
        monkeypatch.setattr(settings, "REGISTRATION_MODE", "open")
        monkeypatch.setattr(settings, "REGISTRATION_INVITE_CODE", "")
        monkeypatch.chdir(tmp_path)
        local = TestClient(app, client=("127.0.0.1", 5555))
        token = local.get("/health").cookies.get("csrf_token", "")
        r = local.post("/api/host/invite", headers={"X-CSRF-Token": token})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["invite_only"] is True
        assert body["invite_code"]
        assert (tmp_path / ".env").exists()
