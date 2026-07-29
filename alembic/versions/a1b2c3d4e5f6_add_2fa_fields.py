"""Add 2FA fields to users table

Revision ID: a1b2c3d4e5f6
Revises: 24d4a0a62ba8
Create Date: 2026-07-10
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'a1b2c3d4e5f6'
down_revision: str | None = '24d4a0a62ba8'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('users', sa.Column('is_2fa_enabled', sa.Boolean(), default=False))
    op.add_column('users', sa.Column('totp_secret', sa.String(), nullable=True))
    op.add_column('users', sa.Column('backup_codes', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('users', 'backup_codes')
    op.drop_column('users', 'totp_secret')
    op.drop_column('users', 'is_2fa_enabled')
