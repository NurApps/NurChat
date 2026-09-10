#!/usr/bin/env python3
"""NurChat SQLite backup with rotation (cross-platform: Windows/Linux/macOS).

Usage:
    .venv/Scripts/python scripts/backup-sqlite.py
    # Windows Task Scheduler (daily): action = .venv\\Scripts\\python.exe,
    #   arguments = scripts\\backup-sqlite.py, start in = repo root.

Keeps last 7 backups in backup/. Uses the SQLite online backup API
(safe while the relay is running), falls back to file copy.
"""
import shutil
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB_FILE = ROOT / "nurchat.db"
BACKUP_DIR = ROOT / "backup"
KEEP = 7


def main() -> int:
    if not DB_FILE.exists():
        print(f"Error: {DB_FILE} not found", file=sys.stderr)
        return 1
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = BACKUP_DIR / f"nurchat_{stamp}.db"

    try:
        src = sqlite3.connect(f"file:{DB_FILE}?mode=ro", uri=True)
        try:
            dst = sqlite3.connect(dest)
            try:
                src.backup(dst)
            finally:
                dst.close()
        finally:
            src.close()
        print(f"Backup written: {dest} ({dest.stat().st_size // 1024} KB)")
    except Exception as e:
        print(f"Online backup failed ({e}), falling back to file copy")
        shutil.copy2(DB_FILE, dest)
        print(f"Backup copied: {dest}")

    # Rotate: keep newest KEEP
    backups = sorted(BACKUP_DIR.glob("nurchat_*.db"), key=lambda p: p.stat().st_mtime)
    for old in backups[:-KEEP]:
        old.unlink()
        print(f"Rotated out: {old.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
