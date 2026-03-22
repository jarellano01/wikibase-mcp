# Plan 05 — Reporting Server Entry Point

**Goal:** Wire up the reporting MCP server with auto-migration on startup, SSE transport, and health endpoint.

**Ref:** [specs/reporting-mcp.md](../specs/reporting-mcp.md), [specs/architecture.md](../specs/architecture.md)

**Depends on:** Plan 03, Plan 04

---

## Files to Create

- `services/reporting/src/reporting_mcp/server.py`
- `services/reporting/src/reporting_mcp/__main__.py`

---

## Steps

- [ ] **Step 1: Write server.py**

```python
# services/reporting/src/reporting_mcp/server.py
"""Reporting MCP Server — entry point with auto-migration on startup."""

import logging
import os
from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware import Middleware

from mcp_shared.auth import AuthMiddleware
from mcp_shared.migrations import run_migrations
from reporting_mcp.config import Settings
from reporting_mcp.db import DatabaseManager, SCHEMA
from reporting_mcp.tools.query import register_query_tools
from reporting_mcp.tools.analysis import register_analysis_tools
from reporting_mcp.tools.upload import register_upload_tools
from reporting_mcp.tools.reports import register_report_tools

logger = logging.getLogger(__name__)
settings: Settings | None = None
db: DatabaseManager | None = None

mcp = FastMCP(
    "Reporting MCP",
    description="Execute SQL and Python against a target database. "
                "Upload and stage files for cross-database analysis.",
)


def get_db():
    if db is None:
        raise RuntimeError("Server not started")
    return db


def get_settings():
    if settings is None:
        raise RuntimeError("Server not started")
    return settings


register_query_tools(mcp, get_db)
register_analysis_tools(mcp, get_db, get_settings)
register_upload_tools(mcp, get_db)
register_report_tools(mcp, get_db)


async def startup():
    global settings, db
    settings = Settings()

    # Auto-migrate reporting schema
    alembic_dir = os.path.join(os.path.dirname(__file__), "..", "..", "alembic")
    await run_migrations(settings.database_url, alembic_dir, SCHEMA)

    db = DatabaseManager(settings.target_database_url, settings.database_url)
    await db.connect()
    logger.info("Reporting MCP started (schema: %s)", SCHEMA)


async def shutdown():
    if db:
        await db.close()


def create_app() -> Starlette:
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def health(request):
        return JSONResponse({"status": "ok", "service": "reporting-mcp"})

    app = Starlette(
        routes=[Route("/health", health)],
        on_startup=[startup],
        on_shutdown=[shutdown],
        middleware=[Middleware(AuthMiddleware, api_key=os.environ.get("API_KEY", ""))],
    )
    app.mount("/", mcp.sse_app())
    return app
```

- [ ] **Step 2: Write __main__.py**

```python
# services/reporting/src/reporting_mcp/__main__.py
import os
import uvicorn
from reporting_mcp.server import create_app

uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
```

- [ ] **Step 3: Smoke test locally**

```bash
# Start local Postgres
docker compose up -d

# Set env vars
export DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_mcp
export TARGET_DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_mcp
export API_KEY=test

# Run server
cd services/reporting && python -m reporting_mcp
# Verify: curl http://localhost:8080/health
```

- [ ] **Step 4: Commit**

```bash
git add services/reporting/src/reporting_mcp/server.py services/reporting/src/reporting_mcp/__main__.py
git commit -m "feat: add reporting server entry point with auto-migration on startup"
```
