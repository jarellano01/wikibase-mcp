"""Knowledge Graph MCP Server -- entry point with auto-migration on startup."""

import logging
import os

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.middleware import Middleware

from mcp_shared.auth import AuthMiddleware
from mcp_shared.migrations import run_migrations
from knowledge_graph_mcp.config import Settings
from knowledge_graph_mcp.db import KnowledgeDB, SCHEMA
from knowledge_graph_mcp.embeddings import embed_text
from knowledge_graph_mcp.tools.knowledge import register_knowledge_tools
from knowledge_graph_mcp.tools.sessions import register_session_tools
from knowledge_graph_mcp.tools.learning import register_learning_tools

logger = logging.getLogger(__name__)
settings: Settings | None = None
db: KnowledgeDB | None = None

mcp = FastMCP(
    "Knowledge Graph MCP",
    instructions="Semantic knowledge base with vector search, exploration sessions, "
                 "and continuous learning. Scope-isolated, tag-discoverable.",
)


def get_db():
    if db is None:
        raise RuntimeError("Server not started")
    return db


def get_settings():
    if settings is None:
        raise RuntimeError("Server not started")
    return settings


# Register all 7 tools
register_knowledge_tools(mcp, get_db, get_settings, embed_text)
register_session_tools(mcp, get_db, get_settings, embed_text)
register_learning_tools(mcp, get_db, get_settings, embed_text)


async def startup():
    global settings, db
    settings = Settings()

    # Auto-migrate knowledge_graph schema
    alembic_dir = os.path.join(os.path.dirname(__file__), "..", "..", "alembic")
    await run_migrations(settings.database_url, alembic_dir, SCHEMA)

    db = KnowledgeDB(settings.database_url)
    await db.connect()
    logger.info("Knowledge Graph MCP started (schema: %s)", SCHEMA)


async def shutdown():
    if db:
        await db.close()


def create_app() -> Starlette:
    from starlette.responses import JSONResponse
    from starlette.routing import Route

    async def health(request):
        return JSONResponse({"status": "ok", "service": "knowledge-graph-mcp"})

    app = Starlette(
        routes=[Route("/health", health)],
        on_startup=[startup],
        on_shutdown=[shutdown],
        middleware=[Middleware(AuthMiddleware, api_key=os.environ.get("API_KEY", ""))],
    )
    app.mount("/", mcp.sse_app())
    return app
