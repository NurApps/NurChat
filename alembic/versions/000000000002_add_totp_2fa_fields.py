"""add totp 2fa fields

Revision ID: 000000000002
Revises: 8a873929c9e0
Create Date: 2026-07-07 12:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '000000000002'
down_revision: str | None = '8a873929c9e0'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Add totp_secret column
    op.add_column('users', sa.Column('totp_secret', sa.String(), nullable=True))

    # Add totp_enabled column
    op.add_column('users', sa.Column('totp_enabled', sa.Boolean(), nullable=True, server_default='false'))

    # Add backup_codes column (stores JSON array of hashed codes)
    op.add_column('users', sa.Column('backup_codes', sa.Text(), nullable=True))


def downgrade() -> None:
    # Remove backup_codes column
    op.drop_column('users', 'backup_codes')

    # Remove totp_enabled column
    op.drop_column('users', 'totp_enabled')

    # Remove totp_secret column
    op.drop_column('users', 'totp_secret')
