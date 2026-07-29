"""add_message_reads_table

Revision ID: fe1064270320
Revises:
Create Date: 2026-07-05 19:56:19.122148
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = 'fe1064270320'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('message_reads',
    sa.Column('id', sa.String(), nullable=False),
    sa.Column('message_id', sa.String(), nullable=False),
    sa.Column('user_id', sa.String(), nullable=False),
    sa.Column('chat_id', sa.String(), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
    sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ),
    sa.ForeignKeyConstraint(['message_id'], ['messages.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('message_id', 'user_id', name='uq_message_user_read')
    )
    op.create_index(op.f('ix_message_reads_id'), 'message_reads', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_message_reads_id'), table_name='message_reads')
    op.drop_table('message_reads')
