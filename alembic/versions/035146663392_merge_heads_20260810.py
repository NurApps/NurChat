"""merge_heads_20260810

Revision ID: 035146663392
Revises: 223344556677, f1e2d3c4b5a6
Create Date: 2026-08-10 22:27:09.333402
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '035146663392'
down_revision: Union[str, None] = ('223344556677', 'f1e2d3c4b5a6')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
