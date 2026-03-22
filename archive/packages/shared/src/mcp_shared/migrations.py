"""Run Alembic migrations programmatically on startup."""

import asyncio
from alembic.config import Config
from alembic import command


async def run_migrations(database_url: str, alembic_dir: str, schema: str):
    """Run alembic upgrade head for the given schema.

    Called once during server startup. Creates schema if needed,
    then applies any pending migrations.
    """
    def _run():
        config = Config()
        config.set_main_option("script_location", alembic_dir)
        config.set_main_option("sqlalchemy.url", database_url)
        config.set_section_option("alembic", "version_table_schema", schema)
        command.upgrade(config, "head")

    await asyncio.to_thread(_run)
