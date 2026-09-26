"""Logout from all devices: users.tokens_valid_after.

Revision ID: 007
Revises: 006
Create Date: 2026-09-26

Unix-секунды. Токен (access/refresh) с iat <= tokens_valid_after считается
отозванным. NULL = «выход со всех устройств» ни разу не вызывали.
Идемпотентно: проверяет наличие колонки через inspector.
"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = '007'
down_revision: str | None = '006'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _columns(inspector, table: str) -> set:
    try:
        return {c["name"] for c in inspector.get_columns(table)}
    except Exception:
        return set()


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "tokens_valid_after" not in _columns(inspector, "users"):
        op.add_column("users", sa.Column("tokens_valid_after", sa.Integer(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "tokens_valid_after" in _columns(inspector, "users"):
        op.drop_column("users", "tokens_valid_after")
