"""merge_heads

Revision ID: 24d4a0a62ba8
Revises: 000000000001, 8a873929c9e0
Create Date: 2026-07-09 00:59:10.004458
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '24d4a0a62ba8'
down_revision: Union[str, None] = ('000000000001', '8a873929c9e0')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
