from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path

from shared.config import settings


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
    ws_logger.addHandler(ws_file_handler)

    db_logger = logging.getLogger("sqlalchemy.engine")
    if settings.DEBUG:
        db_logger.setLevel(logging.INFO)
        db_file_handler = _rotating_handler(log_dir / "database.log")
        db_file_handler.setFormatter(formatter)
        db_logger.addHandler(db_file_handler)

    return logger

# Инициализация логгера
logger = setup_logger()
