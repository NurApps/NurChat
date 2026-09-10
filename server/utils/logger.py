from __future__ import annotations

import logging
import sys

import json
import logging
import sys
import uuid
from contextvars import ContextVar
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path

from shared.config import settings

request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


class SafeStreamHandler(logging.StreamHandler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            super().emit(record)
        except UnicodeEncodeError:
            msg = self.format(record).encode("utf-8", errors="replace").decode()
            try:
                self.stream.write(msg + self.terminator)
                self.flush()
            except Exception:
                self.handleError(record)


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "ts": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get("-"),
        }
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = self.formatException(record.exc_info)
        if hasattr(record, "extra_data"):
            log_entry["extra"] = record.extra_data
        return json.dumps(log_entry, ensure_ascii=False)


class HumanFormatter(logging.Formatter):
    def __init__(self):
        super().__init__(
            fmt="%(asctime)s - %(name)s - %(levelname)s - [%(request_id)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )

    def format(self, record: logging.LogRecord) -> str:
        if not hasattr(record, "request_id"):
            record.request_id = request_id_var.get("-")
        return super().format(record)


def _rotating_handler(path: Path) -> RotatingFileHandler:
    return RotatingFileHandler(path, maxBytes=10 * 1024 * 1024, backupCount=5, encoding="utf-8")


class SafeStreamHandler(logging.StreamHandler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            super().emit(record)
        except UnicodeEncodeError:
            msg = self.format(record).encode('utf-8', errors='replace').decode()
            try:
                self.stream.write(msg + self.terminator)
                self.flush()
            except Exception:
                self.handleError(record)


def _rotating_handler(path: Path) -> RotatingFileHandler:
    return RotatingFileHandler(path, maxBytes=10*1024*1024, backupCount=5, encoding='utf-8')



def setup_logger():
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)

    formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s',
        datefmt='%Y-%m-%d %H:%M:%S'
    )

    use_json = not settings.DEBUG
    formatter: logging.Formatter = JSONFormatter() if use_json else HumanFormatter()

    logger = logging.getLogger("nurchat")
    logger.setLevel(logging.DEBUG if settings.DEBUG else logging.INFO)

    console_handler = SafeStreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    logger.addHandler(console_handler)

    file_handler = _rotating_handler(log_dir / "nurchat.log")
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    ws_logger = logging.getLogger("nurchat_ws")
    ws_logger.setLevel(logging.INFO)
    ws_file_handler = _rotating_handler(log_dir / "websocket.log")
    ws_file_handler.setFormatter(formatter)

    file_handler.setFormatter(JSONFormatter())
    logger.addHandler(file_handler)

    security_handler = _rotating_handler(log_dir / "security.log")
    security_handler.setFormatter(JSONFormatter())
    security_handler.setLevel(logging.WARNING)
    sec_logger = logging.getLogger("nurchat.security")
    sec_logger.addHandler(security_handler)

    ws_logger = logging.getLogger("nurchat_ws")
    ws_logger.setLevel(logging.INFO)
    ws_file_handler = _rotating_handler(log_dir / "websocket.log")
    ws_file_handler.setFormatter(JSONFormatter())
    ws_logger.addHandler(ws_file_handler)

    db_logger = logging.getLogger("sqlalchemy.engine")
    if settings.DEBUG:
        db_logger.setLevel(logging.INFO)
        db_file_handler = _rotating_handler(log_dir / "database.log")
        db_file_handler.setFormatter(formatter)

        db_file_handler.setFormatter(HumanFormatter())
        db_logger.addHandler(db_file_handler)

    return logger


logger = setup_logger()


def generate_request_id() -> str:
    return uuid.uuid4().hex[:12]
