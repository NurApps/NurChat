"""Выход со всех устройств: токены, выпущенные до /logout-all, перестают действовать."""
import time

from fastapi.testclient import TestClient

from server.main import app
from server.utils import security as sec_utils
from test.test_2fa_login import _csrf, _register, _reset  # noqa: F401  (autouse-фикстура _reset)

client = TestClient(app)


def _auth(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}", **_csrf()}


def test_logout_all_revokes_access_and_refresh():
    sec_utils._VALID_AFTER.clear()
    reg = _register("logout_all_user")
    access, refresh = reg["access_token"], reg["refresh_token"]

    assert client.get("/api/auth/me", headers=_auth(access)).status_code == 200
    # iat теперь есть в токенах
    import jwt

    from server.core.security import ALGORITHM, SECRET_KEY
    assert "iat" in jwt.decode(access, SECRET_KEY, algorithms=[ALGORITHM])

    assert client.post("/api/auth/logout-all", headers=_auth(access)).status_code == 200

    assert client.get("/api/auth/me", headers=_auth(access)).status_code == 401
    r = client.post("/api/auth/refresh", json={"refresh_token_str": refresh}, headers=_csrf())
    assert r.status_code == 401


def test_tokens_issued_after_logout_all_work():
    sec_utils._VALID_AFTER.clear()
    reg = _register("logout_all_relogin")
    assert client.post("/api/auth/logout-all", headers=_auth(reg["access_token"])).status_code == 200

    time.sleep(1.1)  # iat имеет секундную точность: новый вход — строго позже отсечки
    r = client.post("/api/auth/login", json={"username": "logout_all_relogin", "password": "TestPass123"}, headers=_csrf())
    assert r.status_code == 200, r.text
    assert client.get("/api/auth/me", headers=_auth(r.json()["access_token"])).status_code == 200


def test_stale_check_only_affects_that_user_and_missing_iat():
    sec_utils._VALID_AFTER.clear()
    sec_utils._valid_after_loaded = True
    sec_utils.remember_tokens_valid_after("u1", 100)
    assert sec_utils.is_token_stale({"sub": "u1", "iat": 100})
    assert sec_utils.is_token_stale({"sub": "u1"})          # токен без iat считается старым
    assert not sec_utils.is_token_stale({"sub": "u1", "iat": 101})
    assert not sec_utils.is_token_stale({"sub": "u2", "iat": 1})
