"""fix audit table name: audit_logs -> audit_log (match models)

Revision ID: 003
Revises: 002
Create Date: 2026-09-11

001 created the table as `audit_logs`, but the model maps `audit_log`
(create_all DBs always had the right name — only alembic-managed DBs
need this rename). Guarded: no-op when already correct.
"""
from collections.abc import Sequence

from alembic import op

revision: str = '003'
down_revision: str | None = '002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _tables(inspector) -> set:
    return set(inspector.get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    import sqlalchemy as _sa
    inspector = _sa.inspect(bind)
    names = _tables(inspector)
    if 'audit_logs' in names and 'audit_log' not in names:
        op.rename_table('audit_logs', 'audit_log')


def downgrade() -> None:
    bind = op.get_bind()
    import sqlalchemy as _sa
    inspector = _sa.inspect(bind)
    names = _tables(inspector)
    if 'audit_log' in names and 'audit_logs' not in names:
        op.rename_table('audit_log', 'audit_logs')
