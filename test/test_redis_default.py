"""Redis выключен по дефолту: без сервера рядом ничего не должно
долбиться в localhost:6379 — presence деградирует молча (in-memory
connection_manager покрывает один инстанс)."""
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import shared.config as config_module
from server.core import redis_manager


def test_use_redis_default_false():
    assert config_module.Settings().USE_REDIS is False


def test_get_redis_none_when_disabled(monkeypatch):
    monkeypatch.setattr(config_module.settings, "USE_REDIS", False)
    monkeypatch.setattr(redis_manager, "_redis_client", None)
    monkeypatch.setattr(redis_manager, "_REDIS_UNAVAILABLE", False)
    assert redis_manager._redis_enabled() is False
    assert redis_manager.get_redis() is None
    assert redis_manager.is_user_online("user_x") is False
    assert redis_manager.get_online_users() == []


def test_redis_enabled_honors_settings(monkeypatch):
    monkeypatch.setattr(config_module.settings, "USE_REDIS", True)
    assert redis_manager._redis_enabled() is True
    monkeypatch.setattr(config_module.settings, "USE_REDIS", False)
    assert redis_manager._redis_enabled() is False
