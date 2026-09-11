import secrets
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


def _encode_password_once(pw: str) -> str:
    """Percent-encode reserved chars in a DB password, idempotently.

    Supabase generates passwords with @ # % ? / etc., which break URI
    parsing (psycopg2: "invalid dsn"). Valid %XX escapes are kept as-is,
    so manually pre-encoded passwords are NOT double-encoded.
    """
    if not any(c in pw for c in "%@/:?#[]&="):
        return pw
    hexdigits = set("0123456789abcdefABCDEF")
    out: list[str] = []
    i = 0
    while i < len(pw):
        c = pw[i]
        if c == "%" and i + 2 < len(pw) and pw[i + 1] in hexdigits and pw[i + 2] in hexdigits:
            out.append(pw[i:i + 3])
            i += 3
            continue
        if c in "%@/:?#[]&=":
            out.append(f"%{ord(c):02X}")
        else:
            out.append(c)
        i += 1
    return "".join(out)


def normalize_database_url(url: str) -> str:
    """Make a Postgres DATABASE_URL driver-proof.

    - strips surrounding whitespace/quotes (dashboard copy-paste)
    - leaves sqlite:// untouched
    - URL-encodes a raw password (Supabase passwords contain @ # % ? /;
      psycopg2 dies with "invalid dsn" otherwise). Valid %XX escapes
      are kept as-is (no double-encoding).
    - splits userinfo on the LAST @ whose right side looks like a host,
      so @ ? / inside the password don't break parsing
    - drops ?pgbouncer=true (libpq chokes on unknown URI options;
      our pooling is client-side anyway), keeps other query params
    """
    import re

    url = (url or "").strip().strip("'\"")
    if not url or url.startswith("sqlite") or "://" not in url:
        return url
    scheme, rest = url.split("://", 1)

    userinfo, hostpath = "", rest
    for m in sorted(re.finditer("@", rest), key=lambda m: m.start(), reverse=True):
        right = rest[m.start() + 1:]
        probe = right
        for sep in ("?", "#"):
            if sep in probe:
                probe = probe.split(sep, 1)[0]
        probe = probe.split("/", 1)[0]
        if probe and "@" not in probe and not any(ch.isspace() for ch in probe):
            userinfo, hostpath = rest[:m.start()], right
            break

    query = ""
    if "?" in hostpath:
        hostpath, query = hostpath.split("?", 1)
        params = [p for p in query.split("&") if p.split("=")[0] != "pgbouncer"]
        query = "&".join(params)
    if "/" in hostpath:
        host, dbname = hostpath.split("/", 1)
    else:
        host, dbname = hostpath, ""
    if "#" in host:
        return url  # too mangled to fix safely; leave for the driver error
    if userinfo and ":" in userinfo:
        user, password = userinfo.split(":", 1)
        userinfo = f"{user}:{_encode_password_once(password)}"
    out = f"{scheme}://"
    if userinfo:
        out += f"{userinfo}@"
    out += host
    if dbname:
        out += f"/{dbname}"
    if query:
        out += f"?{query}"
    return out


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./nurchat.db"
    SERVER_HOST: str = "127.0.0.1"
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
    USE_FEDERATION: bool = True
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
    S3_ACCESS_KEY: str = ""
    S3_SECRET_KEY: str = ""
    S3_BUCKET: str = ""
    S3_REGION: str = "us-east-1"

    # Connection pool (0 = sensible default per dialect).
    # Supabase free allows ~60 direct connections — keep pool small.
    DATABASE_POOL_SIZE: int = 0
    DATABASE_MAX_OVERFLOW: int = 0
    SERVER_HOST: str = "127.0.0.1"
    SERVER_PORT: int = 8000
    DEBUG: bool = False
    # Deaf relay = conductor, not storage: delete message rows after
    # delivery to all recipients (history lives on devices only).
    # True by default — storing other people's plaintext is not our job.
    RELAY_DEAF: bool = True
    MESSAGE_RETENTION_HOURS: int = 48
    CLIENT_HOST: str = "localhost"
    CLIENT_PORT: int = 8001
    MEDIA_ROOT: str = "media"
    MAX_FILE_SIZE: int = 50 * 1024 * 1024
    FILE_TTL_DAYS: int = 30
    ENCRYPTION_KEY: str = ""
    JWT_SECRET_KEY: str = ""
    WS_RECONNECT_TIMEOUT: int = 5
    CLEANUP_INTERVAL_HOURS: int = 6
    ORPHANED_CLEANUP_HOURS: int = 12
    REDIS_URL: str = "redis://localhost:6379/0"
    USE_REDIS: bool = True
    ENABLE_METRICS: bool = False
    LOG_LEVEL: str = "INFO"
    LOG_TO_FILE: bool = True
    TOTP_MASTER_KEY: str = ""


    WS_CONNECTIONS_WARN: int = 100
    ERROR_RATE_WARN: float = 5.0

    # Privacy: store client IPs in audit log / security logs.
    # False = deaf relay sees minimum (no IP column filled).
    # IP rate-limiting still works in-memory regardless of this flag.
    LOG_IPS: bool = False

    VAPID_PRIVATE_KEY: str = ""
    VAPID_CLAIM_EMAIL: str = "admin@nurchat.app"

    # WebRTC (calls): STUN/TURN/ICE. Пусто = только публичные STUN.
    STUN_SERVERS: str = "stun:stun.l.google.com:19302,stun:stun1.l.google.com:19302"
    WEBRTC_ICE_SERVERS: str = ""
    TURN_SERVERS: str = ""
    TURN_USERNAME: str = ""
    TURN_CREDENTIAL: str = "CHANGE_ME_IN_PRODUCTION"

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

        from pydantic_settings.sources import DotEnvSettingsSource

        env_path = Path(__file__).resolve().parent.parent / ".env"

        import sys


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

    @field_validator("DATABASE_URL", mode="before")
    @classmethod
    def normalize_db_url(cls, v: Any) -> Any:
        if isinstance(v, str):
            return normalize_database_url(v)
        return v

def create_directories():
    directories = [
        "media",
        "media/images",
        "media/videos",
        "media/voice",
        "media/documents",
        "media/video_circles",
        "logs",
    ]
    for directory in directories:
        Path(directory).mkdir(parents=True, exist_ok=True)

settings = Settings()

_env_written = False

if settings.ENCRYPTION_KEY == "your_default_encryption_key_here":
    import logging
    import secrets
    logging.critical(
        "[SECURITY] ENCRYPTION_KEY is NOT set in .env! "
        "Generated a TEMPORARY key. "
        "All encrypted data will be LOST on restart. "
        "Set a stable ENCRYPTION_KEY in .env immediately!"
    )
    settings.ENCRYPTION_KEY = secrets.token_hex(32)
    _env_written = True

if not settings.JWT_SECRET_KEY:
    import logging
    import secrets
    logging.critical(
        "[SECURITY] JWT_SECRET_KEY is NOT set in .env! "
        "Generated a TEMPORARY key. "
        "All active sessions will be invalidated on restart (users will be logged out). "
        "Set JWT_SECRET_KEY in .env for production."
    )
    settings.JWT_SECRET_KEY = secrets.token_hex(32)
    _env_written = True

if _env_written:
    import os
    _env_path = Path(os.getcwd()) / ".env"
    try:
        _env_lines = []
        _written_enc = False
        _written_jwt = False
        if _env_path.exists():
            _env_lines = _env_path.read_text().splitlines()
            _existing = {line.split("=", 1)[0] for line in _env_lines if "=" in line}
            if "ENCRYPTION_KEY" not in _existing:
                _env_lines.append(f"ENCRYPTION_KEY={settings.ENCRYPTION_KEY}")
                _written_enc = True
            if "JWT_SECRET_KEY" not in _existing:
                _env_lines.append(f"JWT_SECRET_KEY={settings.JWT_SECRET_KEY}")
                _written_jwt = True
            if _written_enc or _written_jwt:
                _env_path.write_text("\n".join(_env_lines) + "\n")
        else:
            _env_path.write_text(
                f"ENCRYPTION_KEY={settings.ENCRYPTION_KEY}\n"
                f"JWT_SECRET_KEY={settings.JWT_SECRET_KEY}\n"
            )
            _written_enc = True
        if _written_enc or _written_jwt:
            logging.getLogger("nurchat").info("Auto-generated keys written to %s", _env_path)
    except Exception as _exc:
        logging.getLogger("nurchat").warning("Failed to write .env: %s", _exc)

_keys_file = Path(__file__).resolve().parent.parent / ".env"

def _ensure_key(name: str, value: str, generator) -> str:
    if value:
        return value
    generated = generator()
    try:
        existing = _keys_file.read_text(encoding="utf-8") if _keys_file.exists() else ""
        if name not in existing:
            with open(_keys_file, "a", encoding="utf-8") as f:
                f.write(f"\n{name}={generated}\n")
            print(f"[NurChat] Generated {name} and saved to .env")
    except Exception as e:
        print(f"[NurChat] Warning: could not persist {name} to .env: {e}")
    return generated

settings.ENCRYPTION_KEY = _ensure_key("ENCRYPTION_KEY", settings.ENCRYPTION_KEY, lambda: secrets.token_hex(32))
settings.JWT_SECRET_KEY = _ensure_key("JWT_SECRET_KEY", settings.JWT_SECRET_KEY, lambda: secrets.token_hex(32))

ENCRYPTION_KEY = settings.ENCRYPTION_KEY.encode()
