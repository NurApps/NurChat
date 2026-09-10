"""initial schema — all tables

Revision ID: 001
Revises:
Create Date: 2026-08-31
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Users
    op.create_table(
        'users',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('username', sa.String(), unique=True, index=True),
        sa.Column('first_name', sa.String(), nullable=False),
        sa.Column('last_name', sa.String(), nullable=True),
        sa.Column('bio', sa.String(), nullable=True),
        sa.Column('hashed_password', sa.String()),
        sa.Column('public_key', sa.Text()),
        sa.Column('signing_public_key', sa.Text(), nullable=True),
        sa.Column('avatar_path', sa.String(), nullable=True),
        sa.Column('status', sa.String(), default=""),
        sa.Column('totp_secret', sa.String(), nullable=True),
        sa.Column('backup_codes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('last_seen', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_online', sa.Boolean(), default=False),
        sa.Column('is_2fa_enabled', sa.Boolean(), default=False),
    )

    # Chats
    op.create_table(
        'chats',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('name', sa.String(), nullable=True),
        sa.Column('is_group', sa.Boolean(), default=False),
        sa.Column('is_secret', sa.Boolean(), default=False),
        sa.Column('disappears_after_seconds', sa.Integer(), default=0),
        sa.Column('group_key', sa.Text(), nullable=True),
        sa.Column('group_key_creator_id', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Chat participants
    op.create_table(
        'chat_participants',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('chat_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE')),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('is_pinned', sa.Boolean(), default=False),
        sa.Column('is_muted', sa.Boolean(), default=False),
        sa.Column('is_admin', sa.Boolean(), default=False),
    )
    op.create_index('ix_chat_participants_user_chat', 'chat_participants', ['user_id', 'chat_id'])
    op.create_index('ix_chat_participants_user_pin', 'chat_participants', ['user_id', 'is_pinned', 'is_muted'])

    # Files
    op.create_table(
        'files',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('filename', sa.String()),
        sa.Column('file_path', sa.String()),
        sa.Column('file_type', sa.String()),
        sa.Column('file_size', sa.Integer()),
        sa.Column('ttl_days', sa.Integer(), default=30),
        sa.Column('uploaded_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_files_user_uploaded', 'files', ['user_id', 'uploaded_at'])

    # Messages
    op.create_table(
        'messages',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('chat_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE'), index=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('content', sa.Text()),
        sa.Column('encrypted_content', sa.Text(), nullable=True),
        sa.Column('signature', sa.Text(), nullable=True),
        sa.Column('message_type', sa.String(), default='text'),
        sa.Column('file_id', sa.String(), sa.ForeignKey('files.id', ondelete='SET NULL'), nullable=True),
        sa.Column('forwarded_from', sa.String(), nullable=True),
        sa.Column('reply_to_id', sa.String(), sa.ForeignKey('messages.id', ondelete='SET NULL'), nullable=True, index=True),
        sa.Column('is_deleted', sa.Boolean(), default=False),
        sa.Column('deleted_for_all', sa.Boolean(), default=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('edited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('edit_history', sa.Text(), nullable=True),
        sa.Column('scheduled_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_view_once', sa.Boolean(), default=False),
        sa.Column('viewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_messages_chat_created', 'messages', ['chat_id', 'created_at'])
    op.create_index('ix_messages_query', 'messages', ['is_deleted', 'chat_id', 'created_at'])

    # Contacts
    op.create_table(
        'contacts',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('contact_user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_contacts_user_contact', 'contacts', ['user_id', 'contact_user_id'])

    # Group invites
    op.create_table(
        'group_invites',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('group_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE')),
        sa.Column('inviter_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('invitee_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('status', sa.String(), default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_group_invites_invitee_status', 'group_invites', ['invitee_id', 'status'])

    # Message read status
    op.create_table(
        'message_read_status',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('message_id', sa.String(), sa.ForeignKey('messages.id', ondelete='CASCADE')),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('is_read', sa.Boolean(), default=False),
        sa.Column('read_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_read_status_message_user', 'message_read_status', ['message_id', 'user_id'])
    op.create_index('ix_read_status_user_read', 'message_read_status', ['user_id', 'is_read'])

    # Call logs
    op.create_table(
        'call_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('call_id', sa.String(), index=True),
        sa.Column('caller_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('callee_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('call_type', sa.String()),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('ended_at', sa.DateTime(timezone=True)),
        sa.Column('duration', sa.Integer()),
        sa.Column('ended_by', sa.String()),
    )
    op.create_index('ix_call_logs_callee', 'call_logs', ['callee_id'])
    op.create_index('ix_call_logs_caller_started', 'call_logs', ['caller_id', 'started_at'])

    # Group calls
    op.create_table(
        'group_calls',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('call_id', sa.String(), unique=True, index=True),
        sa.Column('chat_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE')),
        sa.Column('created_by', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('call_type', sa.String()),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('ended_at', sa.DateTime(timezone=True)),
    )
    op.create_index('ix_group_calls_chat', 'group_calls', ['chat_id'])

    # Group call participants
    op.create_table(
        'group_call_participants',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('group_call_id', sa.Integer(), sa.ForeignKey('group_calls.id', ondelete='CASCADE')),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('left_at', sa.DateTime(timezone=True)),
        sa.Column('is_muted', sa.Boolean(), default=False),
        sa.Column('is_video_off', sa.Boolean(), default=False),
    )
    op.create_index('ix_group_call_participants_call', 'group_call_participants', ['group_call_id'])

    # Message reactions
    op.create_table(
        'message_reactions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('message_id', sa.String(), sa.ForeignKey('messages.id', ondelete='CASCADE')),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('emoji', sa.String(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_reactions_message', 'message_reactions', ['message_id'])

    # Blocked users
    op.create_table(
        'blocked_users',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('blocked_user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_blocked_user_target', 'blocked_users', ['user_id', 'blocked_user_id'])

    # Audit logs
    op.create_table(
        'audit_logs',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('action', sa.String(), nullable=False),
        sa.Column('details', sa.Text(), nullable=True),
        sa.Column('ip_address', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_audit_logs_user_action', 'audit_logs', ['user_id', 'created_at'])
    op.create_index('ix_audit_logs_action', 'audit_logs', ['action'])

    # P2P messages
    op.create_table(
        'p2p_messages',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('sender_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('recipient_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('delivered_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_p2p_messages_recipient_created', 'p2p_messages', ['recipient_id', 'created_at'])

    # P2P backups
    op.create_table(
        'p2p_backups',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('chat_id', sa.String(), index=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('version', sa.Integer(), default=1),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Bookmarks
    op.create_table(
        'bookmarks',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('message_id', sa.String(), sa.ForeignKey('messages.id', ondelete='CASCADE'), index=True),
        sa.Column('chat_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE'), index=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Pinned messages
    op.create_table(
        'pinned_messages',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('chat_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE'), index=True),
        sa.Column('message_id', sa.String(), sa.ForeignKey('messages.id', ondelete='CASCADE'), index=True),
        sa.Column('pinned_by', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Signed prekeys
    op.create_table(
        'signed_prekeys',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('public_key', sa.Text(), nullable=False),
        sa.Column('signature', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # One-time prekeys
    op.create_table(
        'one_time_prekeys',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('public_key', sa.Text(), nullable=False),
        sa.Column('is_used', sa.Boolean(), default=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Key rotation log
    op.create_table(
        'key_rotation_log',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('old_public_key', sa.Text(), nullable=True),
        sa.Column('new_public_key', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Webhooks
    op.create_table(
        'webhooks',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('name', sa.String(), nullable=False),
        sa.Column('url', sa.String(), nullable=False),
        sa.Column('secret', sa.String(), nullable=True),
        sa.Column('events', sa.String(), nullable=False),
        sa.Column('is_active', sa.Boolean(), default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Polls
    op.create_table(
        'polls',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('chat_id', sa.String(), sa.ForeignKey('chats.id', ondelete='CASCADE'), index=True),
        sa.Column('creator_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('question', sa.Text(), nullable=False),
        sa.Column('is_anonymous', sa.Boolean(), default=True),
        sa.Column('allow_multiple', sa.Boolean(), default=False),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Poll options
    op.create_table(
        'poll_options',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('poll_id', sa.String(), sa.ForeignKey('polls.id', ondelete='CASCADE'), index=True),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('position', sa.Integer(), default=0),
    )

    # Poll votes
    op.create_table(
        'poll_votes',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('poll_id', sa.String(), sa.ForeignKey('polls.id', ondelete='CASCADE'), index=True),
        sa.Column('option_id', sa.Integer(), sa.ForeignKey('poll_options.id', ondelete='CASCADE')),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_poll_votes_poll_user', 'poll_votes', ['poll_id', 'user_id'])

    # Contact requests
    op.create_table(
        'contact_requests',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('from_user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('to_user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('message', sa.String(), nullable=True),
        sa.Column('status', sa.String(), default='pending'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index('ix_contact_requests_to_status', 'contact_requests', ['to_user_id', 'status'])

    # Push subscriptions
    op.create_table(
        'push_subscriptions',
        sa.Column('id', sa.String(), primary_key=True),
        sa.Column('user_id', sa.String(), sa.ForeignKey('users.id', ondelete='CASCADE'), index=True),
        sa.Column('endpoint', sa.Text(), nullable=False),
        sa.Column('p256dh', sa.Text(), nullable=False),
        sa.Column('auth', sa.Text(), nullable=False),
        sa.Column('user_agent', sa.String(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Revoked tokens
    op.create_table(
        'revoked_tokens',
        sa.Column('jti', sa.String(), primary_key=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('revoked_at', sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table('revoked_tokens')
    op.drop_table('push_subscriptions')
    op.drop_table('contact_requests')
    op.drop_table('poll_votes')
    op.drop_table('poll_options')
    op.drop_table('polls')
    op.drop_table('webhooks')
    op.drop_table('key_rotation_log')
    op.drop_table('one_time_prekeys')
    op.drop_table('signed_prekeys')
    op.drop_table('pinned_messages')
    op.drop_table('bookmarks')
    op.drop_table('p2p_backups')
    op.drop_table('p2p_messages')
    op.drop_table('audit_logs')
    op.drop_table('blocked_users')
    op.drop_table('message_reactions')
    op.drop_table('group_call_participants')
    op.drop_table('group_calls')
    op.drop_table('call_logs')
    op.drop_table('message_read_status')
    op.drop_table('group_invites')
    op.drop_table('contacts')
    op.drop_table('messages')
    op.drop_table('files')
    op.drop_table('chat_participants')
    op.drop_table('chats')
    op.drop_table('users')
