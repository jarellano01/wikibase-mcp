"""Alembic environment for reporting schema migrations."""

import os
from logging.config import fileConfig
from alembic import context

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = None


def run_migrations_online():
    from sqlalchemy import create_engine, text

    url = config.get_main_option("sqlalchemy.url") or os.environ.get("DATABASE_URL", "")
    engine = create_engine(url)

    with engine.connect() as connection:
        connection.execute(text("CREATE SCHEMA IF NOT EXISTS reporting"))
        connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema="reporting",
        )

        with context.begin_transaction():
            context.run_migrations()


run_migrations_online()
