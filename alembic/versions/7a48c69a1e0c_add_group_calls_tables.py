"""add group calls tables

Revision ID: 7a48c69a1e0c
Revises: c0de20260810
Create Date: 2026-08-11 13:04:45.161690
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '7a48c69a1e0c'
down_revision: str | None = 'c0de20260810'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table('group_calls',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('call_id', sa.String(), nullable=True),
        sa.Column('chat_id', sa.String(), nullable=True),
        sa.Column('created_by', sa.String(), nullable=True),
        sa.Column('call_type', sa.String(), nullable=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['chat_id'], ['chats.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_group_calls_call_id'), 'group_calls', ['call_id'], unique=True)
    op.create_index('ix_group_calls_chat', 'group_calls', ['chat_id'], unique=False)
    op.create_index(op.f('ix_group_calls_id'), 'group_calls', ['id'], unique=False)

    op.create_table('group_call_participants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('group_call_id', sa.Integer(), nullable=True),
        sa.Column('user_id', sa.String(), nullable=True),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('(CURRENT_TIMESTAMP)'), nullable=True),
        sa.Column('left_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_muted', sa.Boolean(), nullable=True),
        sa.Column('is_video_off', sa.Boolean(), nullable=True),
        sa.ForeignKeyConstraint(['group_call_id'], ['group_calls.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index('ix_group_call_participants_call', 'group_call_participants', ['group_call_id'], unique=False)
    op.create_index(op.f('ix_group_call_participants_id'), 'group_call_participants', ['id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_group_call_participants_id'), table_name='group_call_participants')
    op.drop_index('ix_group_call_participants_call', table_name='group_call_participants')
    op.drop_table('group_call_participants')
    op.drop_index(op.f('ix_group_calls_id'), table_name='group_calls')
    op.drop_index('ix_group_calls_chat', table_name='group_calls')
    op.drop_index(op.f('ix_group_calls_call_id'), table_name='group_calls')
    op.drop_table('group_calls')
