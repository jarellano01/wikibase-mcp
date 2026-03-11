"""propose_knowledge tool — submit discovered patterns as candidates."""

import json
from typing import Any, Callable, Awaitable
from knowledge_graph_mcp.db import KnowledgeDB


async def _propose_knowledge_impl(
    category: str,
    key: str,
    content: str,
    scope: str,
    rationale: str,
    db: KnowledgeDB,
    embed_fn: Callable[[str, str, str], Awaitable[list[float]]],
    project_id: str,
    location: str,
    tags: list[str] | None = None,
    session_id: int | None = None,
) -> dict[str, Any]:
    """Submit a knowledge candidate for review."""
    embedding = await embed_fn(content, project_id, location)

    rows = await db.query(
        """INSERT INTO knowledge_candidates
           (category, key, content, embedding, scope, tags, rationale, session_id)
           VALUES ($1, $2, $3, $4::vector, $5, $6::text[], $7, $8)
           RETURNING id""",
        [category, key, content, str(embedding), scope, tags or [], rationale, session_id],
    )
    return {"candidate_id": rows[0]["id"], "status": "pending"}


def register_learning_tools(mcp, get_db, get_settings, embed_fn):
    @mcp.tool()
    async def propose_knowledge(
        category: str,
        key: str,
        content: str,
        scope: str,
        rationale: str,
        tags: list[str] | None = None,
        session_id: int | None = None,
    ) -> str:
        """Submit a discovered pattern/rule as a candidate for review. Include rationale for why it should become permanent knowledge."""
        s = get_settings()
        result = await _propose_knowledge_impl(
            category, key, content, scope, rationale,
            get_db(), embed_fn, s.gcp_project_id, s.gcp_location,
            tags=tags, session_id=session_id,
        )
        return json.dumps(result, default=str)
