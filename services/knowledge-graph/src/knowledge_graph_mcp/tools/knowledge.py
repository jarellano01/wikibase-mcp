"""get_knowledge and review_knowledge tools."""

import json
from typing import Any, Callable, Awaitable
from knowledge_graph_mcp.db import KnowledgeDB


async def _get_knowledge_impl(
    query: str,
    db: KnowledgeDB,
    embed_fn: Callable[[str, str, str], Awaitable[list[float]]],
    project_id: str,
    location: str,
    category: str | None = None,
    scope: str | None = None,
    tags: list[str] | None = None,
    limit: int = 10,
) -> list[dict[str, Any]]:
    """Semantic search over knowledge base with scope/tag filtering."""
    embedding = await embed_fn(query, project_id, location)

    conditions = ["(scope = $2 OR scope = 'global')"]
    params: list = [str(embedding), scope or "global"]
    param_idx = 3

    if category:
        conditions.append(f"category = ${param_idx}")
        params.append(category)
        param_idx += 1

    if tags:
        conditions.append(f"tags && ${param_idx}::text[]")
        params.append(tags)
        param_idx += 1

    where = " AND ".join(conditions)
    params.append(limit)

    sql = f"""
        SELECT id, category, key, content, scope, tags
        FROM knowledge_base
        WHERE {where}
        ORDER BY embedding <=> $1::vector
        LIMIT ${param_idx}
    """
    return await db.query(sql, params)


async def _review_knowledge_impl(
    candidate_id: int,
    action: str,
    reviewer: str,
    db: KnowledgeDB,
    embed_fn: Callable | None = None,
    project_id: str | None = None,
    location: str | None = None,
) -> str:
    """Approve or reject a knowledge candidate."""
    if action not in ("approve", "reject"):
        return json.dumps({"error": "Action must be 'approve' or 'reject'"})

    if action == "reject":
        await db.execute(
            "UPDATE knowledge_candidates SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
            [reviewer, candidate_id],
        )
        return json.dumps({"status": "rejected", "candidate_id": candidate_id})

    rows = await db.query("SELECT * FROM knowledge_candidates WHERE id = $1", [candidate_id])
    if not rows:
        return json.dumps({"error": f"Candidate {candidate_id} not found"})

    candidate = rows[0]
    embedding = await embed_fn(candidate["content"], project_id, location)

    await db.execute(
        """INSERT INTO knowledge_base (category, key, content, embedding, scope, tags, source)
           VALUES ($1, $2, $3, $4::vector, $5, $6::text[], 'approved_candidate')
           ON CONFLICT (key) DO UPDATE SET content = $3, embedding = $4::vector, scope = $5, tags = $6::text[], updated_at = NOW()""",
        [candidate["category"], candidate["key"], candidate["content"],
         str(embedding), candidate["scope"], candidate["tags"]],
    )
    await db.execute(
        "UPDATE knowledge_candidates SET status = 'approved', reviewed_by = $1, reviewed_at = NOW() WHERE id = $2",
        [reviewer, candidate_id],
    )
    return json.dumps({"status": "approved", "candidate_id": candidate_id, "key": candidate["key"]})


def register_knowledge_tools(mcp, get_db, get_settings, embed_fn):
    @mcp.tool()
    async def get_knowledge(
        query: str,
        category: str | None = None,
        scope: str | None = None,
        tags: list[str] | None = None,
        limit: int = 10,
    ) -> str:
        """Semantic search over knowledge base. Auto-filters by scope + global. Optionally filter by category and tags."""
        s = get_settings()
        results = await _get_knowledge_impl(
            query, get_db(), embed_fn, s.gcp_project_id, s.gcp_location,
            category=category, scope=scope, tags=tags, limit=limit,
        )
        return json.dumps(results, default=str)

    @mcp.tool()
    async def review_knowledge(candidate_id: int, action: str, reviewer: str) -> str:
        """Approve or reject a pending knowledge candidate. On approve, entry is embedded and added to knowledge_base."""
        s = get_settings()
        return await _review_knowledge_impl(
            candidate_id, action, reviewer, get_db(), embed_fn, s.gcp_project_id, s.gcp_location,
        )
