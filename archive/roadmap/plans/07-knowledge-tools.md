# Plan 07 — Knowledge Retrieval & Review Tools

**Goal:** Implement `get_knowledge` (vector search with scope/tags) and `review_knowledge` (approve/reject candidates).

**Ref:** [specs/knowledge-graph-mcp.md](../specs/knowledge-graph-mcp.md)

**Depends on:** Plan 06

---

## Files to Create

- `services/knowledge-graph/src/knowledge_graph_mcp/tools/__init__.py`
- `services/knowledge-graph/src/knowledge_graph_mcp/tools/knowledge.py`
- `services/knowledge-graph/tests/test_knowledge.py`

---

## Steps

### get_knowledge

- [ ] **Step 1: Write failing test**

```python
# services/knowledge-graph/tests/test_knowledge.py
import pytest
from unittest.mock import AsyncMock
from knowledge_graph_mcp.tools.knowledge import _get_knowledge_impl, _review_knowledge_impl


@pytest.mark.asyncio
async def test_get_knowledge_basic(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[
        {"id": 1, "category": "context", "key": "test", "content": "Hello", "scope": "global", "tags": []}
    ])
    result = await _get_knowledge_impl("test query", mock_db, mock_embed, "proj", "us-central1")
    assert len(result) == 1
    assert result[0]["key"] == "test"


@pytest.mark.asyncio
async def test_get_knowledge_with_scope(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[])
    result = await _get_knowledge_impl(
        "test", mock_db, mock_embed, "proj", "us-central1", scope="client:bgc"
    )
    # Verify scope filter was applied (check the SQL params)
    call_args = mock_db.query.call_args
    assert "client:bgc" in call_args[0][1]  # scope in params


@pytest.mark.asyncio
async def test_get_knowledge_with_tags(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[])
    await _get_knowledge_impl(
        "test", mock_db, mock_embed, "proj", "us-central1", tags=["legacy-systems"]
    )
    call_args = mock_db.query.call_args
    assert ["legacy-systems"] in call_args[0][1]  # tags in params
```

- [ ] **Step 2: Write implementation**

```python
# services/knowledge-graph/src/knowledge_graph_mcp/tools/__init__.py
"""Knowledge Graph MCP tool modules."""

# services/knowledge-graph/src/knowledge_graph_mcp/tools/knowledge.py
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

    # Build dynamic WHERE clauses
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

    # Approve: fetch candidate, embed, upsert into knowledge_base
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
```

- [ ] **Step 3: Add review_knowledge tests**

```python
# Append to test_knowledge.py

@pytest.mark.asyncio
async def test_review_approve(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{
        "id": 1, "category": "context", "key": "test-key",
        "content": "Test content", "scope": "global", "tags": [],
    }])
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _review_knowledge_impl(1, "approve", "admin", mock_db, mock_embed, "proj", "us-central1")
    parsed = json.loads(result)
    assert parsed["status"] == "approved"


@pytest.mark.asyncio
async def test_review_reject(mock_db, mock_embed):
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _review_knowledge_impl(1, "reject", "admin", mock_db)
    parsed = json.loads(result)
    assert parsed["status"] == "rejected"


@pytest.mark.asyncio
async def test_review_invalid_action(mock_db, mock_embed):
    result = await _review_knowledge_impl(1, "invalid", "admin", mock_db)
    parsed = json.loads(result)
    assert "error" in parsed
```

Verify: `pytest services/knowledge-graph/tests/test_knowledge.py -v`

- [ ] **Step 4: Commit**

```bash
git add services/knowledge-graph/src/knowledge_graph_mcp/tools/ services/knowledge-graph/tests/test_knowledge.py
git commit -m "feat: add get_knowledge (vector search + scope/tags) and review_knowledge tools"
```
