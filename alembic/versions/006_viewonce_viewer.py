"""View-once viewer binding: messages.viewed_by.

Revision ID: 006
Revises: 005
Create Date: 2026-09-24

Без привязки зрителя одноразовость файлов не реализуема: destructive-read
при скачивании должен срабатывать только для того, кто открыл сообщение
через mark-эндпоинт, а не для любого участника (иначе кражa чужого просмотра)
и не для отправителя (у него оригинал). NULL = ещё никто не смотрел.
Идемпотентно: проверяет наличие колонки через inspector.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '006'
down_revision: str | None = '005'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(inspector, table: str) -> set:
    try:
        return {c["name"] for c in inspector.get_columns(table)}
    except Exception:
        return set()


def upgrade() -> None:
    bind = op.get_bind()
    import sqlalchemy as _sa
    inspector = _sa.inspect(bind)
    if "viewed_by" not in _columns(inspector, "messages"):
        op.add_column("messages", sa.Column("viewed_by", sa.String(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    import sqlalchemy as _sa
    inspector = _sa.inspect(bind)
    if "viewed_by" in _columns(inspector, "messages"):
        op.drop_column("messages", "viewed_by")
