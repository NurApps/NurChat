"""add webhooks table

Revision ID: 112233445566
Revises: b0a1c2d3e4f6
Create Date: 2026-07-29 14:00:00.000000
"""
import sqlalchemy as sa

from alembic import op

revision = "112233445566"
down_revision = "b0a1c2d3e4f6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "webhooks",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("url", sa.String(), nullable=False),
        sa.Column("secret", sa.String(), nullable=True),
        sa.Column("events", sa.String(), nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_webhooks_id"), "webhooks", ["id"])
    op.create_index(op.f("ix_webhooks_user_id"), "webhooks", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_webhooks_id"), table_name="webhooks")
    op.drop_index(op.f("ix_webhooks_user_id"), table_name="webhooks")
    op.drop_table("webhooks")
