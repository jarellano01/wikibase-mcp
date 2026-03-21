# Plan 02 — Shared Package (mcp-shared)

**Goal:** Build the `mcp-shared` package with AuthMiddleware, BaseDB (with schema support), and Alembic migration runner.

**Ref:** [specs/shared-package.md](../specs/shared-package.md), [specs/architecture.md](../specs/architecture.md)

---

## Files to Create

- `packages/shared/pyproject.toml`
- `packages/shared/src/mcp_shared/__init__.py`
- `packages/shared/src/mcp_shared/auth.py`
- `packages/shared/src/mcp_shared/db.py`
- `packages/shared/src/mcp_shared/migrations.py`
- `packages/shared/tests/test_auth.py`
- `packages/shared/tests/test_db.py`

---

## Steps

- [ ] **Step 1: Write pyproject.toml**

```toml
[project]
name = "mcp-shared"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "starlette>=0.36.0",
    "asyncpg>=0.30.0",
    "alembic>=1.13.0",
]

[project.optional-dependencies]
dev = ["pytest>=8.0.0", "pytest-asyncio>=0.23.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"
```

- [ ] **Step 2: Write __init__.py**

```python
"""MCP Shared — common auth, database, and migration infrastructure for ai-mcp services."""
```

- [ ] **Step 3: Write auth tests (TDD — test first)**

```python
# packages/shared/tests/test_auth.py
import pytest
from starlette.testclient import TestClient
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from mcp_shared.auth import AuthMiddleware


def _make_app(api_key: str):
    async def home(request):
        return JSONResponse({"ok": True})

    async def health(request):
        return JSONResponse({"status": "ok"})

    return Starlette(
        routes=[Route("/", home), Route("/health", health)],
        middleware=[Middleware(AuthMiddleware, api_key=api_key)],
    )


def test_valid_bearer_token():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/", headers={"Authorization": "Bearer test-key"})
    assert resp.status_code == 200


def test_missing_token_returns_401():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/")
    assert resp.status_code == 401


def test_wrong_token_returns_401():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


def test_health_endpoint_bypasses_auth():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/health")
    assert resp.status_code == 200
```

Run: `pytest packages/shared/tests/test_auth.py -v`
Expected: FAIL with `ImportError`

- [ ] **Step 4: Write auth.py implementation**

```python
# packages/shared/src/mcp_shared/auth.py
"""Bearer token authentication middleware for MCP services."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, api_key: str):
        super().__init__(app)
        self.api_key = api_key

    async def dispatch(self, request: Request, call_next):
        if request.url.path == "/health":
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth[7:] != self.api_key:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)
```

Run: `pytest packages/shared/tests/test_auth.py -v`
Expected: 4 passed

- [ ] **Step 5: Write db.py with schema support**

```python
# packages/shared/src/mcp_shared/db.py
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
```

- [ ] **Step 6: Write migrations.py**

```python
# packages/shared/src/mcp_shared/migrations.py
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
```

- [ ] **Step 7: Write db tests**

```python
# packages/shared/tests/test_db.py
import pytest
from mcp_shared.db import BaseDB


def test_basedb_init_default_schema():
    db = BaseDB("postgresql://fake", schema="reporting")
    assert db.schema == "reporting"


def test_basedb_not_connected_raises():
    db = BaseDB("postgresql://fake")
    import asyncio
    with pytest.raises(RuntimeError, match="not connected"):
        asyncio.get_event_loop().run_until_complete(db.query("SELECT 1"))
```

- [ ] **Step 8: Install and verify**

```bash
cd ai-mcp && uv sync
pytest packages/shared/tests/ -v
```

- [ ] **Step 9: Commit**

```bash
git add packages/shared/
git commit -m "feat: add mcp-shared package with auth, BaseDB (schema support), and migration runner"
```
