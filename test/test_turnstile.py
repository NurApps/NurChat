"""Turnstile siteverify: fail-closed на каждой ветке, без реальных запросов в Cloudflare."""
import asyncio
import json
from urllib.parse import parse_qs

import httpx
import pytest
from fastapi.testclient import TestClient

from server.main import app
from server.utils import captcha
from shared.rate_limiter import limiter

client = TestClient(app)


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    limiter.reset()
    monkeypatch.setattr(captcha.settings, "TURNSTILE_SECRET", "test-secret")
    monkeypatch.setattr(captcha.settings, "TURNSTILE_HOSTNAMES", "tauri.localhost, 127.0.0.1")


def _siteverify(monkeypatch, handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []
    real_client = httpx.AsyncClient

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    def factory(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(recording)
        return real_client(*args, **kwargs)

    monkeypatch.setattr(captcha.httpx, "AsyncClient", factory)
    return seen


def _reply(**body):
    return lambda _req: httpx.Response(200, json=body)


def _verify(token="tok", action="signup") -> bool:
    return asyncio.run(captcha.verify_turnstile(token, action))


def test_accepts_valid_response(monkeypatch):
    seen = _siteverify(monkeypatch, _reply(success=True, action="signup", hostname="tauri.localhost"))
    assert _verify() is True
    form = parse_qs(seen[0].content.decode())
    assert seen[0].url == captcha.SITEVERIFY_URL
    assert form == {"secret": ["test-secret"], "response": ["tok"]}


@pytest.mark.parametrize("body", [
    {"success": False, "action": "signup", "hostname": "tauri.localhost"},
    {"success": True, "action": "login", "hostname": "tauri.localhost"},
    {"success": True, "hostname": "tauri.localhost"},
    {"success": True, "action": "signup", "hostname": "evil.example.com"},
    {"success": "true", "action": "signup", "hostname": "tauri.localhost"},
])
def test_rejects_bad_result(monkeypatch, body):
    _siteverify(monkeypatch, _reply(**body))
    assert _verify() is False


@pytest.mark.parametrize("handler", [
    lambda _r: httpx.Response(500, json={"success": True}),
    lambda _r: httpx.Response(200, text="not json"),
    lambda _r: httpx.Response(200, json=["success"]),
])
def test_rejects_upstream_garbage(monkeypatch, handler):
    _siteverify(monkeypatch, handler)
    assert _verify() is False


def test_rejects_network_error(monkeypatch):
    def boom(req):
        raise httpx.ConnectError("down", request=req)
    _siteverify(monkeypatch, boom)
    assert _verify() is False


@pytest.mark.parametrize("token", ["", "x" * 2049])
def test_rejects_bad_token_without_calling_cloudflare(monkeypatch, token):
    seen = _siteverify(monkeypatch, _reply(success=True, action="signup", hostname="tauri.localhost"))
    assert _verify(token=token) is False
    assert seen == []


@pytest.mark.parametrize("field", ["TURNSTILE_SECRET", "TURNSTILE_HOSTNAMES"])
def test_fails_closed_when_not_configured(monkeypatch, field):
    seen = _siteverify(monkeypatch, _reply(success=True, action="signup", hostname="tauri.localhost"))
    monkeypatch.setattr(captcha.settings, field, "")
    assert _verify() is False
    assert seen == []


def test_captcha_endpoint_returns_sitekey():
    r = client.get("/api/auth/captcha")
    assert r.status_code == 200
    assert r.json() == {"provider": "turnstile", "sitekey": "1x00000000000000000000AA"}


def test_captcha_endpoint_503_without_sitekey(monkeypatch):
    monkeypatch.setattr(captcha.settings, "TURNSTILE_SITEKEY", "")
    assert client.get("/api/auth/captcha").status_code == 503


def test_register_rejects_bad_token():
    csrf = {"X-CSRF-Token": client.get("/health").cookies.get("csrf_token", "")}
    r = client.post("/api/auth/register", json={
        "username": "bot_user", "password": "TestPass123", "first_name": "Bot",
        "public_key": "a" * 64, "signing_public_key": "b" * 64,
        "turnstile_token": "forged",
    }, headers=csrf)
    assert r.status_code == 400
    assert "CAPTCHA" in json.dumps(r.json(), ensure_ascii=False)
