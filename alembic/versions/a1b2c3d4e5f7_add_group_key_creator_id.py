"""add group_key_creator_id to chats

Revision ID: a1b2c3d4e5f7
Revises: fe1064270320, 7a48c69a1e0c
Create Date: 2026-08-17
"""
import sqlalchemy as sa

from alembic import op

revision = "a1b2c3d4e5f7"
down_revision = ("fe1064270320", "7a48c69a1e0c")
branch_labels = None
depends_on = None

def upgrade():
    op.add_column("chats", sa.Column("group_key_creator_id", sa.String, nullable=True))

def downgrade():
    op.drop_column("chats", "group_key_creator_id")
