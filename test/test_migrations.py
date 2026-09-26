"""Миграции end-to-end: чистая БД через `alembic upgrade head`.

Ловит дрейф вида «001 NOT NULL vs модель nullable», который create_all-тесты
не видят (там схема всегда из моделей). Гоняется в CI (pytest test/).
"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))


def _upgrade_tmp_db(monkeypatch) -> str:
    # env.py игнорирует sqlalchemy.url из конфига и всегда берёт
    # settings.DATABASE_URL — поэтому патчим настройки, а не конфиг.
    from alembic.config import Config

    from alembic import command
    from shared.config import settings

    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setattr(settings, "DATABASE_URL", f"sqlite:///{tmp.name}")
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    return tmp.name


def _drop_tmp_db(engine, db_path: str) -> None:
    try:
        engine.dispose()
    except Exception:
        pass
    try:
        os.unlink(db_path)
    except OSError:
        pass


def test_upgrade_head_reaches_007(monkeypatch):
    from sqlalchemy import create_engine, text

    db_path = _upgrade_tmp_db(monkeypatch)
    e = create_engine(f"sqlite:///{db_path}")
    try:
        with e.connect() as c:
            ver = c.execute(text("SELECT version_num FROM alembic_version")).scalar()
            assert ver == "007", ver
            cols = {r[1] for r in c.execute(text("PRAGMA table_info(users)"))}
            assert "tokens_valid_after" in cols
    finally:
        _drop_tmp_db(e, db_path)


def test_e2e_reaction_without_emoji_on_migrated_schema(monkeypatch):
    """E2E-реакция (tag + enc_emoji, emoji=NULL) вставляется в БД,
    поднятую миграциями, а не create_all (001 держала emoji NOT NULL)."""
    from sqlalchemy import create_engine, text

    db_path = _upgrade_tmp_db(monkeypatch)
    e = create_engine(f"sqlite:///{db_path}")
    try:
        with e.connect() as c:
            c.execute(text(
                "INSERT INTO users (id, username, first_name, hashed_password) "
                "VALUES ('u1', 'a', 'A', 'x')"
            ))
            c.execute(text(
                "INSERT INTO chats (id, is_group) VALUES ('c1', 0)"
            ))
            c.execute(text(
                "INSERT INTO messages (id, chat_id, user_id, content) "
                "VALUES ('m1', 'c1', 'u1', '[encrypted]')"
            ))
            c.execute(text(
                "INSERT INTO message_reactions (message_id, user_id, emoji, tag, enc_emoji) "
                "VALUES ('m1', 'u1', NULL, 'tag123', 'ZW5j')"
            ))
            c.commit()
            n = c.execute(text("SELECT count(*) FROM message_reactions")).scalar()
            assert n == 1
    finally:
        _drop_tmp_db(e, db_path)


def test_viewed_by_column_exists(monkeypatch):
    from sqlalchemy import create_engine, text

    db_path = _upgrade_tmp_db(monkeypatch)
    e = create_engine(f"sqlite:///{db_path}")
    try:
        with e.connect() as c:
            cols = [r[1] for r in c.execute(text("PRAGMA table_info(messages)")).fetchall()]
            assert "viewed_by" in cols
            assert "delivered_at" in cols
    finally:
        _drop_tmp_db(e, db_path)
