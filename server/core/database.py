from sqlalchemy import create_engine, event
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from shared.config import settings

# Detect dialect for connection args
_is_sqlite = settings.DATABASE_URL.startswith("sqlite")
connect_args = {"check_same_thread": False} if _is_sqlite else {}

engine = create_engine(
    settings.DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_size=5 if _is_sqlite else 20,
    max_overflow=10 if _is_sqlite else 40,
)

if _is_sqlite:

    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def create_tables():
    """
    Создаёт таблицы через Alembic миграции.
    Fallback: если Alembic недоступен — create_all.
    """
    import sys

    from server.core import models  # noqa: F401 — registers models

    if getattr(sys, 'frozen', False):
        Base.metadata.create_all(bind=engine)
        return

    try:
        from alembic.config import Config

        from alembic import command
        alembic_cfg = Config("alembic.ini")
        command.upgrade(alembic_cfg, "head")
    except Exception as e:
        print(f"Alembic fallback, using create_all: {e}")
        Base.metadata.create_all(bind=engine)
