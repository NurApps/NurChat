import sys
from pathlib import Path
from typing import Any

# Должно быть самым первым — до любого вывода в консоль
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(errors='replace')

from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./nurchat.db"
    SERVER_HOST: str = "127.0.0.1"
    SERVER_PORT: int = 8000
    DEBUG: bool = False
    USE_P2P: bool = True
    P2P_SIGNALING_PATH: str = "/ws/p2p"
    P2P_RELAY_STORE_MESSAGES: bool = True
    P2P_PENDING_LIMIT: int = 500
    P2P_PENDING_TTL_DAYS: int = 7
    # ── Глухой relay (публичные инстансы) ──
    # RELAY_DEAF=true: сервер хранит сообщения только до доставки получателю
    # и принимает ТОЛЬКО E2E-шифрованные сообщения (plaintext отклоняется).
    RELAY_DEAF: bool = False
    # Сколько часов держать недоставленное сообщение офлайн-получателя
    MESSAGE_RETENTION_HOURS: int = 48
    P2P_DISCOVERY_TTL_SECONDS: int = 300
    WEBRTC_ICE_SERVERS: str | None = None  # JSON: [{"urls":"stun:...","username":"...","credential":"..."}]
    TURN_SERVERS: str | None = None  # JSON: [{"urls":"turn:...","username":"...","credential":"..."}]
    TURN_USERNAME: str = "nurchat"
    TURN_CREDENTIAL: str = "CHANGE_ME_IN_PRODUCTION"
    STUN_SERVERS: str = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    CLIENT_HOST: str = "localhost"

    CLIENT_PORT: int = 8001
    MEDIA_ROOT: str = "media"
    MAX_FILE_SIZE: int = 50 * 1024 * 1024
    FILE_TTL_DAYS: int = 30
    ENCRYPTION_KEY: str = ""
    JWT_SECRET_KEY: str = ""  # Auto-generated if empty, separate from ENCRYPTION_KEY
    WS_RECONNECT_TIMEOUT: int = 5
    CLEANUP_INTERVAL_HOURS: int = 6
    ORPHANED_CLEANUP_HOURS: int = 12
    REDIS_URL: str = "redis://localhost:6379/0"
    USE_REDIS: bool = True
    ENABLE_METRICS: bool = False
    LOG_LEVEL: str = "INFO"
    LOG_TO_FILE: bool = True
    TOTP_MASTER_KEY: str = ""  # Auto-generated if empty, persisted to .env

    # Alert thresholds
    WS_CONNECTIONS_WARN: int = 100
    ERROR_RATE_WARN: float = 5.0

    # Web Push (VAPID)
    VAPID_PRIVATE_KEY: str = ""  # Auto-generated if empty (PEM format)
    VAPID_CLAIM_EMAIL: str = "admin@nurchat.app"

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls,
        init_settings,
        env_settings,
        dotenv_settings,
        file_secret_settings,
    ):
        import os
        import sys

        from pydantic_settings.sources import DotEnvSettingsSource

        # When frozen (PyInstaller), look for .env next to the exe
        if getattr(sys, 'frozen', False):
            exe_dir = Path(sys.executable).resolve().parent
            env_path = exe_dir / ".env"
        else:
            env_path = Path(__file__).resolve().parent.parent / ".env"

        if not env_path.exists():
            env_path = Path(os.getcwd()) / ".env"

        dotenv = DotEnvSettingsSource(settings_cls, env_file=str(env_path)) if env_path.exists() else dotenv_settings
        return (init_settings, env_settings, file_secret_settings, dotenv)

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, v: Any) -> bool:
        if isinstance(v, bool):
            return v
        if isinstance(v, str):
            return v.lower() not in ("0", "false", "no", "off", "release")
        return bool(v)

# Создаем необходимые директории
def create_directories():
    directories = [
        "media",
        "media/images",
        "media/videos",
        "media/voice",
        "media/documents",
        "media/video_circles",
        "logs",
        "legal"
    ]
    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)

settings = Settings()

# Auto-generate and persist keys if not set — users should NOT need .env for this
_keys_file = Path(__file__).resolve().parent.parent / ".env"

def _ensure_key(name: str, value: str, generator) -> str:
    """Return existing value or generate, persist to .env, and return."""
    if value:
        return value
    generated = generator()
    # Persist to .env for next restart
    try:
        existing = _keys_file.read_text(encoding="utf-8") if _keys_file.exists() else ""
        if name not in existing:
            with open(_keys_file, "a", encoding="utf-8") as f:
                f.write(f"\n{name}={generated}\n")
            print(f"[NurChat] Generated {name} and saved to .env")
        else:
            # Key exists in .env but wasn't loaded — env var takes precedence, just use it
            pass
    except Exception as e:
        print(f"[NurChat] Warning: could not persist {name} to .env: {e}")
    return generated

import secrets
settings.ENCRYPTION_KEY = _ensure_key("ENCRYPTION_KEY", settings.ENCRYPTION_KEY, lambda: secrets.token_hex(32))
settings.JWT_SECRET_KEY = _ensure_key("JWT_SECRET_KEY", settings.JWT_SECRET_KEY, lambda: secrets.token_hex(32))

ENCRYPTION_KEY = settings.ENCRYPTION_KEY.encode()

