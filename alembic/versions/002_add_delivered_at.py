"""add delivered_at to messages (deaf relay)

Revision ID: 002
Revises: 001
Create Date: 2026-09-10
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '002'
down_revision: str | None = '001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('messages') as batch_op:
        batch_op.add_column(sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('messages') as batch_op:
        batch_op.drop_column('delivered_at')
