"""Base database connection management using asyncpg with schema isolation."""

import asyncpg


class BaseDB:
    def __init__(self, url: str, schema: str = "public"):
        self.url = url
        self.schema = schema
        self._pool: asyncpg.Pool | None = None

    async def connect(self):
        self._pool = await asyncpg.create_pool(self.url, min_size=1, max_size=3)
        if self.schema != "public":
            async with self._pool.acquire() as conn:
                await conn.execute(f"CREATE SCHEMA IF NOT EXISTS {self.schema}")

    async def close(self):
        if self._pool:
            await self._pool.close()

    async def query(self, sql: str, params: list | None = None) -> list[dict]:
        if self._pool is None:
            raise RuntimeError("Database not connected")
        async with self._pool.acquire() as conn:
            await conn.execute(f"SET search_path TO {self.schema},public")
            rows = await conn.fetch(sql, *(params or []))
            return [dict(r) for r in rows]

    async def execute(self, sql: str, params: list | None = None) -> str:
        if self._pool is None:
            raise RuntimeError("Database not connected")
        async with self._pool.acquire() as conn:
            await conn.execute(f"SET search_path TO {self.schema},public")
            return await conn.execute(sql, *(params or []))
