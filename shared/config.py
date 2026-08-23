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
    DEBUG: bool = True
    USE_P2P: bool = True
    P2P_SIGNALING_PATH: str = "/ws/p2p"
    P2P_RELAY_STORE_MESSAGES: bool = True
    P2P_PENDING_LIMIT: int = 500
    P2P_PENDING_TTL_DAYS: int = 7
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

if not settings.ENCRYPTION_KEY:
    import logging
    logging.critical(
        "\n" + "!" * 72 + "\n"
        "[FATAL] ENCRYPTION_KEY is NOT set!\n"
        "Set a stable ENCRYPTION_KEY in .env or environment variable.\n"
        "Generate with: python -c \"import secrets; print(secrets.token_hex(32))\"\n"
        + "!" * 72
    )
    raise RuntimeError(
        "ENCRYPTION_KEY is required. Set it in .env or as environment variable."
    )

if not settings.JWT_SECRET_KEY:
    import logging
    logging.critical(
        "\n" + "!" * 72 + "\n"
        "[FATAL] JWT_SECRET_KEY is NOT set!\n"
        "Set JWT_SECRET_KEY in .env or environment variable.\n"
        "Generate with: python -c \"import secrets; print(secrets.token_hex(32))\"\n"
        + "!" * 72
    )
    raise RuntimeError(
        "JWT_SECRET_KEY is required. Set it in .env or as environment variable."
    )

ENCRYPTION_KEY = settings.ENCRYPTION_KEY.encode()

