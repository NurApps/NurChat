"""Сквозной тест аватарок: загрузка → static-раздача → удаление.

Регрессия на баг «загрузка работает, а картинки нигде не отображаются»:
раньше /media/avatars не был смонтирован и GET отдавал 404.
"""

import io
import re
import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server.main import app
from shared.rate_limiter import limiter
from test.conftest import TURNSTILE_TEST_TOKEN

client = TestClient(app)


def _csrf_headers() -> dict:
    r = client.get("/health")
    return {"X-CSRF-Token": r.cookies.get("csrf_token", "")}


def _make_png(color=(42, 171, 238), size=(64, 64)) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", size, color).save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _reset_limiter():
    limiter.reset()


@pytest.fixture()
def user(request):
    suffix = re.sub(r"\W", "", request.node.name)[:16]
    r = client.post("/api/auth/register", json={
        "username": f"avatar_{suffix}", "password": "TestPass123",
        "first_name": "Ava",
        "public_key": "a" * 64, "signing_public_key": "b" * 64,
        "turnstile_token": TURNSTILE_TEST_TOKEN,
    }, headers=_csrf_headers())
    assert r.status_code == 200, r.text
    data = r.json()
    token = data["access_token"]
    uid = data["user"]["id"]
    yield {"token": token, "id": uid}
    # Чистим файловый мусор теста (БД чистит глобальный conftest).
    shutil.rmtree(Path("media/avatars") / uid, ignore_errors=True)


def _auth(user) -> dict:
    return {"Authorization": f"Bearer {user['token']}", **_csrf_headers()}


class TestAvatarFlow:
    def test_upload_served_and_deleted(self, user):
        # 1. Загрузка настоящей картинки.
        png = _make_png()
        r = client.post(
            "/api/auth/profile/avatar",
            files={"file": ("ava.png", png, "image/png")},
            headers=_auth(user),
        )
        assert r.status_code == 200, r.text
        avatar_path = r.json()["avatar_path"]
        assert avatar_path.startswith(f"media/avatars/{user['id']}/avatar_")
        assert avatar_path.endswith(".png")

        # 2. Раздача: тот же путь, что кладёт в avatarUrl() фронт.
        r = client.get(f"/{avatar_path}")
        assert r.status_code == 200, f"GET {avatar_path}: {r.status_code}"
        assert r.headers["content-type"].startswith("image/")
        assert len(r.content) > 0

        # 3. Удаление.
        r = client.delete("/api/auth/profile/avatar", headers=_auth(user))
        assert r.status_code == 200, r.text
        assert r.json()["avatar_path"] is None

        # 4. Старый файл больше не отдаётся.
        r = client.get(f"/{avatar_path}")
        assert r.status_code == 404

    def test_non_image_rejected(self, user):
        r = client.post(
            "/api/auth/profile/avatar",
            files={"file": ("evil.jpg", b"not an image at all", "image/jpeg")},
            headers=_auth(user),
        )
        assert r.status_code == 400

    def test_bad_extension_rejected(self, user):
        r = client.post(
            "/api/auth/profile/avatar",
            files={"file": ("x.exe", _make_png(), "image/png")},
            headers=_auth(user),
        )
        assert r.status_code == 400

    def test_path_traversal_not_served(self, user):
        r = client.get("/media/avatars/../../shared/config.py")
        assert r.status_code in (403, 404)
