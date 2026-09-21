"""E2E reactions: blinded toggle tag + encrypted emoji on message_reactions.

Revision ID: 004
Revises: 003
Create Date: 2026-09-20

Adds nullable `tag` / `enc_emoji` columns (legacy `emoji` rows keep working
and are NOT backfilled — old reactions go E2E only when re-reacted).
Guarded with inspector checks so create_all DBs and re-runs are safe.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '004'
down_revision: str | None = '003'
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
    cols = _columns(inspector, "message_reactions")
    if "tag" not in cols:
        op.add_column("message_reactions", sa.Column("tag", sa.String(), nullable=True))
    cols = _columns(inspector, "message_reactions")
    if "enc_emoji" not in cols:
        op.add_column("message_reactions", sa.Column("enc_emoji", sa.Text(), nullable=True))
    try:
        op.create_index("ix_reactions_toggle", "message_reactions",
                        ["message_id", "user_id", "tag"], unique=False)
    except Exception:
        pass  # index already exists (re-run / create_all DB)


def downgrade() -> None:
    try:
        op.drop_index("ix_reactions_toggle", table_name="message_reactions")
    except Exception:
        pass
    bind = op.get_bind()
    import sqlalchemy as _sa
    inspector = _sa.inspect(bind)
    cols = _columns(inspector, "message_reactions")
    if "enc_emoji" in cols:
        op.drop_column("message_reactions", "enc_emoji")
    if "tag" in cols:
        op.drop_column("message_reactions", "tag")
