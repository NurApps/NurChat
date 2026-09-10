"""Интеграционный тест полного цикла 2FA: enable -> login (2fa_pending) -> verify-login."""
import re

import pytest
from fastapi.testclient import TestClient

from server.main import app
from shared.rate_limiter import limiter

client = TestClient(app)


def _csrf() -> dict:
    r = client.get("/health")
    return {"X-CSRF-Token": r.cookies.get("csrf_token", "")}


def _captcha() -> tuple[str, str]:
    r = client.get("/api/auth/captcha")
    data = r.json()
    q = data["question"]
    nums = [int(n) for n in re.findall(r"\d+", q)]
    if "\u00d7" in q or "x" in q:
        ans = nums[0] * nums[1]
    elif "-" in q:
        ans = nums[0] - nums[1]
    else:
        ans = nums[0] + nums[1]
    return data["captcha_id"], str(ans)


@pytest.fixture(autouse=True)
def _reset():
    limiter.reset()
    from server.core import models
    from server.core.database import SessionLocal
    db = SessionLocal()
    try:
        for table in [models.MessageReadStatus, models.Message,
                      models.ChatParticipant, models.Chat, models.User]:
            db.query(table).delete()
        db.commit()
    finally:
        db.close()


def _register(username: str) -> dict:
    cid, ans = _captcha()
    r = client.post("/api/auth/register", json={
        "username": username, "password": "TestPass123", "first_name": "Tst",
        "public_key": "a" * 64, "signing_public_key": "b" * 64,
        "captcha_id": cid, "captcha_code": ans,
    }, headers=_csrf())
    assert r.status_code == 200, r.text
    return r.json()


class TestTwoFactorLogin:
    def test_full_cycle(self):
        import pyotp
        reg = _register("u2fa_user")
        token = reg["access_token"]
        h = {**_csrf(), "Authorization": f"Bearer {token}"}

        # Setup 2FA (requires password in body)
        r = client.post("/api/auth/2fa/setup", json={"password": "TestPass123"}, headers=h)
        assert r.status_code == 200, r.text
        setup = r.json()
        secret = setup["secret"]

        # Enable with valid TOTP code
        code = pyotp.TOTP(secret).now()
        r = client.post("/api/auth/2fa/enable", json={"code": code, "password": "TestPass123"}, headers=h)
        assert r.status_code == 200, r.text

        # Login -> requires_2fa with pending tokens
        r = client.post("/api/auth/login",
                        json={"username": "u2fa_user", "password": "TestPass123"},
                        headers=_csrf())
        assert r.status_code == 200, r.text
        login = r.json()
        assert login.get("requires_2fa") is True
        pending = login["access_token"]

        # Pending token must NOT grant API access
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {pending}"})
        assert r.status_code == 401

        # Wrong code rejected
        ph = {"Authorization": f"Bearer {pending}", **_csrf()}
        r = client.post("/api/auth/2fa/verify-login", json={"code": "000000"}, headers=ph)
        assert r.status_code == 401

        # Correct code issues full token
        good = pyotp.TOTP(secret).now()
        r = client.post("/api/auth/2fa/verify-login", json={"code": good}, headers=ph)
        assert r.status_code == 200, r.text
        full = r.json()
        assert full["access_token"]

        # Full token works
        r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {full['access_token']}"})
        assert r.status_code == 200
        assert r.json()["username"] == "u2fa_user"

    def test_backup_code_login(self):
        import pyotp
        reg = _register("u2fa_backup")
        h = {**_csrf(), "Authorization": f"Bearer {reg['access_token']}"}

        r = client.post("/api/auth/2fa/setup", json={"password": "TestPass123"}, headers=h)
        secret = r.json()["secret"]
        r = client.post("/api/auth/2fa/enable", json={"code": pyotp.TOTP(secret).now(), "password": "TestPass123"}, headers=h)
        assert r.status_code == 200, r.text
        backup_codes = r.json().get("backup_codes") or []

        login = client.post("/api/auth/login",
                            json={"username": "u2fa_backup", "password": "TestPass123"},
                            headers=_csrf()).json()
        assert login.get("requires_2fa") is True
        ph = {"Authorization": f"Bearer {login['access_token']}", **_csrf()}

        # Backup codes may be returned as plaintext list or hashed; skip if hashed
        if not backup_codes:
            pytest.skip("backup_codes не возвращаются в открытом виде")
        r = client.post("/api/auth/2fa/verify-login", json={"code": backup_codes[0]}, headers=ph)
        assert r.status_code == 200, r.text
