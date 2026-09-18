from __future__ import annotations

import os
import sys
from logging.config import fileConfig

from alembic import context

# Add project root to path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from server.core import models  # noqa: F401 - registers all models
from server.core.database import Base
from shared.config import settings

config = context.config
# ConfigParser interpolates % on read — escape it, otherwise passwords
# with %XX escapes (Supabase) crash migrations with "invalid interpolation".
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # НЕ engine_from_config: Supabase pooler (Supavisor) требует
    # connect_timeout, иначе первое заявление умирает с "server closed
    # the connection unexpectedly". Именованные секции (-n) не используем.
    from sqlalchemy import create_engine
    from sqlalchemy import pool as sa_pool

    url = settings.DATABASE_URL
    connect_args = (
        {} if url.startswith("sqlite") else {"connect_timeout": 10}
    )
    connectable = create_engine(
        url, poolclass=sa_pool.NullPool, connect_args=connect_args
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
