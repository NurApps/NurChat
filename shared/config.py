from pathlib import Path
from typing import Any

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./nurchat.db"
    SERVER_HOST: str = "0.0.0.0"
    SERVER_PORT: int = 8000
    DEBUG: bool = True
    USE_P2P: bool = True
    P2P_SIGNALING_PATH: str = "/ws/p2p"
    P2P_RELAY_STORE_MESSAGES: bool = True
    P2P_PENDING_LIMIT: int = 500
    P2P_DISCOVERY_TTL_SECONDS: int = 300
    USE_IPFS: bool = True
    IPFS_API_URL: str = "http://127.0.0.1:5001"
    USE_FEDERATED_BACKUP: bool = False
    FEDERATED_BACKUP_URL: str | None = None

    # Federation (server-to-server)
    USE_FEDERATION: bool = False
    FEDERATION_SERVER_NAME: str = ""  # Public server address, e.g. "nurchat.example.com:8000"
    FEDERATION_SERVER_KEY_PATH: str = "federation_keys.json"
    FEDERATION_ACTIVITY_TTL_HOURS: int = 72
    FEDERATION_MAX_INBOX_SIZE: int = 1000
    FEDERATION_ALLOWED_SERVERS: str = ""  # Comma-separated whitelist, empty = allow all
    WEBRTC_ICE_SERVERS: str | None = None  # JSON: [{"urls":"stun:...","username":"...","credential":"..."}]
    CLIENT_HOST: str = "localhost"

    # S3 / MinIO
    USE_S3_STORAGE: bool = False
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "nurchat"
    S3_SECRET_KEY: str = "nurchat-secret"
    S3_BUCKET: str = "nurchat-media"
    S3_REGION: str = "us-east-1"
    CLIENT_PORT: int = 8001
    MEDIA_ROOT: str = "media"
    MAX_FILE_SIZE: int = 50 * 1024 * 1024
    FILE_TTL_DAYS: int = 30
    ENCRYPTION_KEY: str = "your_default_encryption_key_here"
    JWT_SECRET_KEY: str = ""  # Auto-generated if empty, separate from ENCRYPTION_KEY
    WS_RECONNECT_TIMEOUT: int = 5
    CLEANUP_INTERVAL_HOURS: int = 6
    ORPHANED_CLEANUP_HOURS: int = 12
    REDIS_URL: str = "redis://localhost:6379/0"
    USE_REDIS: bool = False
    ENABLE_METRICS: bool = False
    LOG_LEVEL: str = "INFO"
    LOG_TO_FILE: bool = True

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        case_sensitive=False,
        extra="ignore",
    )

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

create_directories()
settings = Settings()

if settings.ENCRYPTION_KEY == "your_default_encryption_key_here":
    import secrets
    import logging
    logging.critical(
        "⚠️  ENCRYPTION_KEY is NOT set! Generated a TEMPORARY key. "
        "All encrypted data will be LOST on restart. "
        "Set a stable ENCRYPTION_KEY in .env immediately!"
    )
    settings.ENCRYPTION_KEY = secrets.token_hex(32)

if not settings.JWT_SECRET_KEY:
    import secrets
    import logging
    logging.warning(
        "JWT_SECRET_KEY is not set in .env. Generated a temporary key. "
        "All active sessions will be invalidated on restart (users will be logged out). "
        "Set JWT_SECRET_KEY in .env for production."
    )
    settings.JWT_SECRET_KEY = secrets.token_hex(32)

ENCRYPTION_KEY = settings.ENCRYPTION_KEY.encode()