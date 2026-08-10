"""Add polls, contact_requests, view-once, scheduled messages

Revision ID: c0de20260810
Revises: 035146663392
Create Date: 2026-08-10
"""
import sqlalchemy as sa

from alembic import op

revision = "c0de20260810"
down_revision = "035146663392"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Messages: new columns
    with op.batch_alter_table("messages") as batch:
        batch.add_column(sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("is_view_once", sa.Boolean(), default=False))
        batch.add_column(sa.Column("viewed_at", sa.DateTime(timezone=True), nullable=True))

    # Polls
    op.create_table(
        "polls",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("chat_id", sa.String(), sa.ForeignKey("chats.id"), nullable=False, index=True),
        sa.Column("creator_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("question", sa.String(), nullable=False),
        sa.Column("is_anonymous", sa.Boolean(), default=True),
        sa.Column("allow_multiple", sa.Boolean(), default=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Poll options
    op.create_table(
        "poll_options",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("poll_id", sa.String(), sa.ForeignKey("polls.id"), nullable=False, index=True),
        sa.Column("text", sa.String(), nullable=False),
        sa.Column("position", sa.Integer(), default=0),
    )

    # Poll votes
    op.create_table(
        "poll_votes",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("poll_id", sa.String(), sa.ForeignKey("polls.id"), nullable=False, index=True),
        sa.Column("option_id", sa.String(), sa.ForeignKey("poll_options.id"), nullable=False),
        sa.Column("user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Contact requests
    op.create_table(
        "contact_requests",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("from_user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("to_user_id", sa.String(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("message", sa.String(), nullable=True),
        sa.Column("status", sa.String(), default="pending"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_contact_requests_to", "contact_requests", ["to_user_id", "status"])
    op.create_index("ix_contact_requests_from", "contact_requests", ["from_user_id"])


def downgrade() -> None:
    op.drop_table("contact_requests")
    op.drop_table("poll_votes")
    op.drop_table("poll_options")
    op.drop_table("polls")

    with op.batch_alter_table("messages") as batch:
        batch.drop_column("viewed_at")
        batch.drop_column("is_view_once")
        batch.drop_column("scheduled_at")
