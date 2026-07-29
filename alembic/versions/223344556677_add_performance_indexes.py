"""add performance indexes

Revision ID: 223344556677
Revises: 112233445566
Create Date: 2026-07-29 15:00:00.000000
"""

from alembic import op

revision = "223344556677"
down_revision = "112233445566"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Message: user_id + is_deleted query index
    op.create_index("ix_messages_user_id", "messages", ["user_id"])
    op.create_index("ix_messages_query", "messages", ["is_deleted", "chat_id", "created_at"])

    # ChatParticipant: pinned/muted filter
    op.create_index(
        "ix_chat_participants_user_pin",
        "chat_participants",
        ["user_id", "is_pinned", "is_muted"],
    )

    # MessageReadStatus: unread count queries
    op.create_index(
        "ix_read_status_user_read",
        "message_read_status",
        ["user_id", "is_read"],
    )

    # CallLog: user call history
    op.create_index(
        "ix_call_logs_caller_started",
        "call_logs",
        ["caller_id", "started_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_user_id", table_name="messages")
    op.drop_index("ix_messages_query", table_name="messages")
    op.drop_index("ix_chat_participants_user_pin", table_name="chat_participants")
    op.drop_index("ix_read_status_user_read", table_name="message_read_status")
    op.drop_index("ix_call_logs_caller_started", table_name="call_logs")
