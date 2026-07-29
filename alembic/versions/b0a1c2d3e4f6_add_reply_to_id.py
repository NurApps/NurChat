"""add reply_to_id to messages

Revision ID: b0a1c2d3e4f6
Revises: 000000000003
Create Date: 2026-07-29 12:00:00.000000
"""
import sqlalchemy as sa

from alembic import op

revision = "b0a1c2d3e4f6"
down_revision = "000000000003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("reply_to_id", sa.String(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "reply_to_id")
