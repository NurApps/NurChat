"""add composite indexes phase 2

Revision ID: 000000000003
Revises: merge_totp_20260722
Create Date: 2026-07-22 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = '000000000003'
down_revision: str | None = 'merge_totp_20260722'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_index('ix_files_user_uploaded', 'files', ['user_id', 'uploaded_at'], unique=False)
    op.create_index('ix_contacts_user_contact', 'contacts', ['user_id', 'contact_user_id'], unique=False)
    op.create_index('ix_group_invites_invitee_status', 'group_invites', ['invitee_id', 'status'], unique=False)
    op.create_index('ix_read_status_message_user', 'message_read_status', ['message_id', 'user_id'], unique=False)
    op.create_index('ix_call_logs_callee', 'call_logs', ['callee_id'], unique=False)
    op.create_index('ix_reactions_message', 'message_reactions', ['message_id'], unique=False)
    op.create_index('ix_blocked_user_target', 'blocked_users', ['user_id', 'blocked_user_id'], unique=False)
    op.create_index('ix_audit_logs_user_action', 'audit_logs', ['user_id', 'created_at'], unique=False)
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'], unique=False)
    op.create_index('ix_p2p_messages_recipient_created', 'p2p_messages', ['recipient_id', 'created_at'], unique=False)
    op.create_index('ix_fed_activity_sender', 'federation_activities', ['sender_server', 'created_at'], unique=False)
    op.create_index('ix_fed_activity_type', 'federation_activities', ['activity_type', 'created_at'], unique=False)


def downgrade() -> None:
    op.drop_index('ix_fed_activity_type', table_name='federation_activities')
    op.drop_index('ix_fed_activity_sender', table_name='federation_activities')
    op.drop_index('ix_p2p_messages_recipient_created', table_name='p2p_messages')
    op.drop_index('ix_audit_logs_action', table_name='audit_logs')
    op.drop_index('ix_audit_logs_user_action', table_name='audit_logs')
    op.drop_index('ix_blocked_user_target', table_name='blocked_users')
    op.drop_index('ix_reactions_message', table_name='message_reactions')
    op.drop_index('ix_call_logs_callee', table_name='call_logs')
    op.drop_index('ix_read_status_message_user', table_name='message_read_status')
    op.drop_index('ix_group_invites_invitee_status', table_name='group_invites')
    op.drop_index('ix_contacts_user_contact', table_name='contacts')
    op.drop_index('ix_files_user_uploaded', table_name='files')
