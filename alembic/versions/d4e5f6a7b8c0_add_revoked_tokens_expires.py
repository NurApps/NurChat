"""add expires_at to revoked_tokens

Revision ID: d4e5f6a7b8c0
Revises: c3d4e5f6a7b9
Create Date: 2026-08-21
"""
import sqlalchemy as sa

from alembic import op

revision = "d4e5f6a7b8c0"
down_revision = "c3d4e5f6a7b9"
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("revoked_tokens", sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True))

def downgrade():
    op.drop_column("revoked_tokens", "expires_at")
