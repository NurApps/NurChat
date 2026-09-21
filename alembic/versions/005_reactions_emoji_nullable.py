"""E2E reactions: message_reactions.emoji nullable.

Revision ID: 005
Revises: 004
Create Date: 2026-09-21

001 создавала emoji NOT NULL (legacy plaintext), а модель
(MessageReaction.emoji) и E2E-реакции (tag + enc_emoji, emoji=NULL)
требуют nullable. Без этого чистая БД через alembic падает
с IntegrityError на первой E2E-реакции.
Идемпотентно: проверяет текущий nullable через inspector.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '005'
down_revision: str | None = '004'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    try:
        cols = {c["name"]: c for c in inspector.get_columns("message_reactions")}
    except Exception:
        return
    emoji_col = cols.get("emoji")
    if not emoji_col or emoji_col.get("nullable", True):
        return
    with op.batch_alter_table("message_reactions") as batch_op:
        batch_op.alter_column(
            "emoji",
            existing_type=sa.String(),
            nullable=True,
        )


def downgrade() -> None:
    # Обратно в NOT NULL не возвращаем: legacy-строки уже могут
    # содержать NULL (E2E-реакции). Downgrade — no-op осознанно.
    pass
