# Shared Package Spec — `mcp-shared`

Common infrastructure used by all MCP services in the monorepo.

## Package: `packages/shared/`

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
```

## Components

### `mcp_shared.auth` — AuthMiddleware

Bearer token validation middleware for Starlette.

- Checks `Authorization: Bearer <key>` header on every request
- Bypasses auth for `/health` endpoint
- Returns 401 JSON response on failure

```python
class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, api_key: str): ...
    async def dispatch(self, request, call_next): ...
```

### `mcp_shared.db` — BaseDB

Asyncpg connection pool manager. Services inherit or compose from this.

```python
class BaseDB:
    def __init__(self, url: str, schema: str = "public"): ...
    async def connect(self): ...     # Creates pool, sets search_path to schema
    async def close(self): ...
    async def query(self, sql, params=None) -> list[dict]: ...
    async def execute(self, sql, params=None) -> str: ...
```

**Schema support:** On `connect()`, executes `CREATE SCHEMA IF NOT EXISTS <schema>` and `SET search_path TO <schema>,public`. This ensures the schema exists and all queries run within it.

### `mcp_shared.migrations` — Migration Runner

Helper to run Alembic migrations programmatically on startup.

```python
async def run_migrations(database_url: str, alembic_dir: str, schema: str):
    """Run alembic upgrade head for the given schema.

    Called once during server startup. Creates schema if needed,
    then applies any pending migrations.
    """
```

Uses `alembic.config.Config` and `alembic.command.upgrade` under the hood. Sets `version_table_schema` so each service tracks its own migration history independently.
