"""Database connection management — target (read-only) + shared PG (reporting schema)."""

import re
from mcp_shared.db import BaseDB

SCHEMA = "reporting"


class DatabaseManager:
    """Manages two connections: target DB (read-only) and shared PG (reporting.* schema)."""

    def __init__(self, target_url: str, database_url: str):
        self._target = BaseDB(target_url)
        self._reporting = BaseDB(database_url, schema=SCHEMA)

    async def connect(self):
        await self._target.connect()
        await self._reporting.connect()

    async def close(self):
        await self._target.close()
        await self._reporting.close()

    def _validate_select(self, sql: str):
        stripped = sql.strip().rstrip(";")
        if ";" in stripped:
            raise ValueError("Only a single statement is allowed")
        if not re.match(r"(?i)^\s*(SELECT|WITH)\b", stripped):
            raise ValueError("Only SELECT (or WITH ... SELECT) queries are allowed")

    async def target_query(self, sql: str, params: list | None = None, timeout: float = 30.0) -> list[dict]:
        """Execute a read-only query against the target database. SELECT-only."""
        self._validate_select(sql)
        if self._target._pool is None:
            raise RuntimeError("Not connected")
        async with self._target._pool.acquire() as conn:
            return [dict(r) for r in await conn.fetch(sql, *(params or []), timeout=timeout)]

    async def reporting_query(self, sql: str, params: list | None = None) -> list[dict]:
        """Query the reporting schema in the shared PG."""
        return await self._reporting.query(sql, params)

    async def reporting_execute(self, sql: str, params: list | None = None) -> str:
        """Execute a statement in the reporting schema."""
        return await self._reporting.execute(sql, params)
