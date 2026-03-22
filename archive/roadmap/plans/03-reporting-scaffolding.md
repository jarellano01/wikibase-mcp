# Plan 03 — Reporting Service Scaffolding

**Goal:** Create the reporting service package with config, DatabaseManager, and Alembic setup in `reporting.*` schema.

**Ref:** [specs/reporting-mcp.md](../specs/reporting-mcp.md), [specs/architecture.md](../specs/architecture.md)

**Depends on:** Plan 01, Plan 02

---

## Files to Create

- `services/reporting/pyproject.toml`
- `services/reporting/src/reporting_mcp/__init__.py`
- `services/reporting/src/reporting_mcp/config.py`
- `services/reporting/src/reporting_mcp/db.py`
- `services/reporting/tests/conftest.py`
- `services/reporting/tests/test_config.py`
- `services/reporting/alembic.ini`
- `services/reporting/alembic/env.py`
- `services/reporting/alembic/versions/.gitkeep`

---

## Steps

- [ ] **Step 1: Write pyproject.toml**

```toml
[project]
name = "reporting-mcp"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "mcp-shared",
    "mcp>=1.0.0",
    "asyncpg>=0.30.0",
    "sqlalchemy[asyncio]>=2.0.0",
    "pandas>=2.2.0",
    "numpy>=1.26.0",
    "scikit-learn>=1.4.0",
    "matplotlib>=3.8.0",
    "openpyxl>=3.1.0",
    "uvicorn>=0.27.0",
    "starlette>=0.36.0",
    "python-dotenv>=1.0.0",
    "alembic>=1.13.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=4.1.0",
]

[tool.uv.sources]
mcp-shared = { workspace = true }

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Write config.py (TDD — test first)**

```python
# services/reporting/tests/test_config.py
import pytest
from reporting_mcp.config import Settings


def test_settings_loads(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://shared")
    monkeypatch.setenv("TARGET_DATABASE_URL", "postgresql://target")
    monkeypatch.setenv("API_KEY", "test")
    s = Settings()
    assert s.database_url == "postgresql://shared"
    assert s.target_database_url == "postgresql://target"


def test_settings_missing_raises(monkeypatch):
    for k in ["DATABASE_URL", "TARGET_DATABASE_URL", "API_KEY"]:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ValueError):
        Settings()
```

Run: `pytest services/reporting/tests/test_config.py -v`
Expected: FAIL with `ImportError`

- [ ] **Step 3: Write config.py implementation**

```python
# services/reporting/src/reporting_mcp/config.py
"""Application configuration from environment variables."""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_url: str       # Shared PG (reporting.* schema) — for staged_uploads, report_history
    target_database_url: str  # Read-only target database for queries
    api_key: str

    def __init__(self):
        self.database_url = os.environ.get("DATABASE_URL", "")
        self.target_database_url = os.environ.get("TARGET_DATABASE_URL", "")
        self.api_key = os.environ.get("API_KEY", "")
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if not self.target_database_url:
            missing.append("TARGET_DATABASE_URL")
        if not self.api_key:
            missing.append("API_KEY")
        if missing:
            raise ValueError(f"Missing: {', '.join(missing)}")
```

Run: `pytest services/reporting/tests/test_config.py -v`
Expected: 2 passed

- [ ] **Step 4: Write db.py (uses BaseDB with schema isolation)**

```python
# services/reporting/src/reporting_mcp/db.py
"""Database connection management — target (read-only) + shared PG (reporting schema)."""

import re
from mcp_shared.db import BaseDB

SCHEMA = "reporting"


class DatabaseManager:
    """Manages two connections: target DB (read-only) and shared PG (reporting.* schema)."""

    def __init__(self, target_url: str, database_url: str):
        self._target = BaseDB(target_url)  # No schema — queries target's public schema
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
```

- [ ] **Step 5: Write conftest.py**

```python
# services/reporting/tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from reporting_mcp.db import DatabaseManager


@pytest.fixture
def mock_db():
    db = MagicMock(spec=DatabaseManager)
    db.target_query = AsyncMock(return_value=[])
    db.reporting_query = AsyncMock(return_value=[])
    db.reporting_execute = AsyncMock(return_value="INSERT 0 1")
    return db
```

- [ ] **Step 6: Set up Alembic for reporting schema**

Create `services/reporting/alembic.ini` and `services/reporting/alembic/env.py` configured to use `reporting` as the version_table_schema. The initial migration should create:

```sql
CREATE TABLE reporting.staged_uploads (
    id SERIAL PRIMARY KEY,
    file_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    columns JSONB NOT NULL,
    row_count INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE TABLE reporting.report_history (
    id SERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    sql_queries JSONB DEFAULT '[]',
    output TEXT,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 7: Install and verify**

```bash
cd ai-mcp && uv sync
pytest services/reporting/tests/ -v
```

- [ ] **Step 8: Commit**

```bash
git add services/reporting/
git commit -m "feat: scaffold reporting service with config, DB manager, and Alembic migrations"
```
