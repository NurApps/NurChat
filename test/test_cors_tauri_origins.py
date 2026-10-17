"""Дефолтный CORS обязан пускать все origin'ы Tauri-приложения.

Tauri 2 на Windows/Android отдаёт фронт с http://tauri.localhost
(https:// — только при useHttpsScheme), на macOS/iOS — tauri://localhost.
Без http-варианта fetch из APK/exe режется CORS и в UI виден «Failed to fetch».
"""
import pytest
from fastapi.testclient import TestClient

from server.main import app

TAURI_ORIGINS = ["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"]


@pytest.mark.parametrize("origin", TAURI_ORIGINS)
def test_default_cors_allows_tauri_origin(origin):
    client = TestClient(app, base_url="http://127.0.0.1:8000")
    resp = client.options(
        "/health", headers={"Origin": origin, "Access-Control-Request-Method": "GET"}
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") == origin
