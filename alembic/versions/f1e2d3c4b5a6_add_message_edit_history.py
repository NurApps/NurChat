"""add message edit history

Revision ID: f1e2d3c4b5a6
Revises: merge_totp_20260722
Create Date: 2026-08-09

"""
import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision = 'f1e2d3c4b5a6'
down_revision = 'merge_totp_20260722'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('messages', sa.Column('edit_history', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'edit_history')
    op.drop_column('messages', 'edited_at')
