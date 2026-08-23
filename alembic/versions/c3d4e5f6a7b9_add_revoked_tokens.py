"""add revoked_tokens table

Revision ID: c3d4e5f6a7b9
Revises: b2c3d4e5f6a8
Create Date: 2026-08-21
"""
import sqlalchemy as sa

from alembic import op

revision = "c3d4e5f6a7b9"
down_revision = "b2c3d4e5f6a8"
branch_labels = None
depends_on = None

def upgrade():
    op.create_table(
        "revoked_tokens",
        sa.Column("jti", sa.String, primary_key=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_revoked_tokens_jti", "revoked_tokens", ["jti"])

def downgrade():
    op.drop_index("ix_revoked_tokens_jti", table_name="revoked_tokens")
    op.drop_table("revoked_tokens")
