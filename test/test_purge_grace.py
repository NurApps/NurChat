"""Deaf-purge не теряет сообщения: grace доставленных + поздно вошедшие.

Без grace второе устройство и клиент, упавший до рендера, теряли сообщение
навсегда (delivered_at ставился при первом fetch истории). Без late-joiner
защиты вступивший позже участник лишался истории (строк статусов по нему
нет — purge считал всё прочитанным).
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import server.core.background_tasks as bt
from server.core import models  # noqa: F401
from server.core.database import Base
from shared.config import settings


def _session_factory():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


def _seed_dm(factory, delivered_ago=None, created_ago=timedelta(hours=12)):
    db = factory()
    now = datetime.now(timezone.utc)
    db.add(models.User(id="u1", username="a", first_name="A", hashed_password="x"))
    db.add(models.User(id="u2", username="b", first_name="B", hashed_password="x"))
    db.add(models.Chat(id="c1", is_group=False))
    db.add(models.ChatParticipant(chat_id="c1", user_id="u1",
                                 joined_at=now - timedelta(days=2)))
    db.add(models.ChatParticipant(chat_id="c1", user_id="u2",
                                 joined_at=now - timedelta(days=2)))
    db.add(models.Message(
        id="m1", chat_id="c1", user_id="u1", content="[encrypted]",
        created_at=now - created_ago,
        delivered_at=(now - delivered_ago) if delivered_ago else None,
    ))
    db.commit()
    db.close()


def _run_purge(monkeypatch, factory):
    monkeypatch.setattr(bt, "SessionLocal", factory)
    monkeypatch.setattr(settings, "RELAY_DEAF", True)
    monkeypatch.setattr(settings, "MESSAGE_RETENTION_HOURS", 48)
    monkeypatch.setattr(settings, "DELIVERED_GRACE_HOURS", 24)
    asyncio.run(bt._deaf_relay_purge())


def _exists(factory, msg_id="m1") -> bool:
    db = factory()
    try:
        return db.query(models.Message).filter(models.Message.id == msg_id).first() is not None
    finally:
        db.close()


def test_freshly_delivered_kept(monkeypatch):
    f = _session_factory()
    _seed_dm(f, delivered_ago=timedelta(hours=1))
    _run_purge(monkeypatch, f)
    assert _exists(f) is True


def test_old_delivered_purged(monkeypatch):
    f = _session_factory()
    _seed_dm(f, delivered_ago=timedelta(hours=25),
             created_ago=timedelta(hours=30))
    _run_purge(monkeypatch, f)
    assert _exists(f) is False


def test_late_joiner_keeps_group_history(monkeypatch):
    f = _session_factory()
    db = f()
    now = datetime.now(timezone.utc)
    db.add(models.User(id="u1", username="a", first_name="A", hashed_password="x"))
    db.add(models.User(id="u2", username="b", first_name="B", hashed_password="x"))
    db.add(models.Chat(id="g1", is_group=True))
    db.add(models.ChatParticipant(chat_id="g1", user_id="u1",
                                 joined_at=now - timedelta(days=2)))
    # u2 вступил ЧАС назад — старых сообщений в глаза не видел.
    db.add(models.ChatParticipant(chat_id="g1", user_id="u2",
                                 joined_at=now - timedelta(hours=1)))
    db.add(models.Message(
        id="gm1", chat_id="g1", user_id="u1", content="[encrypted]",
        created_at=now - timedelta(days=1),
    ))
    db.add(models.MessageReadStatus(message_id="gm1", user_id="u1", is_read=True))
    db.commit()
    db.close()
    _run_purge(monkeypatch, f)
    assert _exists(f, "gm1") is True
