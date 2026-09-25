"""Показывает, какую БД реально возьмёт сервер (тот же резолв, что pydantic).

Окружение бьёт .env — это стандарт, но молчаливое затенение DATABASE_URL
из .env системной переменной (напр. старый sqlite-хвост) выглядит как
«run.bat берёт sqlite вместо .env». Скрипт печатает диалект + источник,
пароль никогда не выводит. Exit 0 всегда (только информация).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from shared.config import settings  # noqa: E402

url = settings.DATABASE_URL or ""
from_env = "DATABASE_URL" in os.environ

if url.startswith("sqlite"):
    # путь из sqlite:///./nurchat.db или sqlite:///abs/path
    path = url.split("://", 1)[1] if "://" in url else url
    print(f"[..] DB: sqlite ({path}) (source: {'environment' if from_env else '.env/default'})")
else:
    host = url.split("://", 1)[1].split("@")[-1].split("/")[0] if "://" in url else "?"
    print(f"[..] DB: postgres ({host}) (source: {'environment' if from_env else '.env'})")
    if from_env:
        print("[!!] DATABASE_URL задан в окружении — он затеняет .env. "
              "Если нужен .env: удалите переменную из системы (setx DATABASE_URL \"\" / set DATABASE_URL=).")
