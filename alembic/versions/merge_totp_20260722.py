"""merge totp branch back into main

Revision ID: merge_totp_20260722
Revises: a1b2c3d4e5f6, 000000000002
Create Date: 2026-07-22 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

revision: str = 'merge_totp_20260722'
down_revision: str | Sequence[str] | None = ('a1b2c3d4e5f6', '000000000002')
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
