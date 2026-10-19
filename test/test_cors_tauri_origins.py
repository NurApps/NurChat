"""Дефолтные allowlist'ы обязаны пускать все origin'ы Tauri-приложения.

Tauri 2 на Windows/Android отдаёт фронт с http://tauri.localhost
(https:// — только при useHttpsScheme), на macOS/iOS — tauri://localhost.
Без http-варианта fetch из APK/exe режется CORS и в UI виден «Failed to fetch»,
а passkeys отклоняются с «Origin не разрешён для passkeys».
"""
import pytest
from fastapi.testclient import TestClient

from server.main import app
from server.routes.webauthn import _pick_rp_id
from shared.config import settings

TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]


@pytest.mark.parametrize("origin", TAURI_ORIGINS)
def test_default_cors_allows_tauri_origin(origin):
    client = TestClient(app, base_url="http://127.0.0.1:8000")
    resp = client.options(
        "/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == origin


@pytest.mark.parametrize(
    ("origin", "expected_rp_id"),
    [
        ("tauri://localhost", "localhost"),
        ("http://tauri.localhost", "tauri.localhost"),
        ("https://tauri.localhost", "tauri.localhost"),
    ],
)
def test_default_webauthn_allows_tauri_origin(origin, expected_rp_id, monkeypatch):
    default = type(settings).model_fields["WEBAUTHN_ORIGINS"].default
    monkeypatch.setattr(settings, "WEBAUTHN_ORIGINS", default)
    assert _pick_rp_id(origin) == (expected_rp_id, origin)
