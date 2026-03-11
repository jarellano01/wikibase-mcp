"""Run the Knowledge Graph MCP server via ``python -m knowledge_graph_mcp``."""

import os

import uvicorn

from knowledge_graph_mcp.server import create_app

uvicorn.run(create_app(), host="0.0.0.0", port=int(os.environ.get("PORT", 8080)))
