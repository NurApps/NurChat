"""add composite indexes

Revision ID: 000000000001
Revises: 000000000000
Create Date: 2026-07-08 00:00:00.000000
"""
from collections.abc import Sequence

from alembic import op

revision: str = '000000000001'
down_revision: str | None = '000000000000'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index('ix_messages_chat_created', 'messages', ['chat_id', 'created_at'], unique=False)
    op.create_index('ix_chat_participants_user_chat', 'chat_participants', ['user_id', 'chat_id'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_chat_participants_user_chat', table_name='chat_participants')
    op.drop_index('ix_messages_chat_created', table_name='messages')
