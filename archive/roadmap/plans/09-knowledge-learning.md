# Plan 09 — Knowledge Learning (propose_knowledge)

**Goal:** Implement `propose_knowledge` — submit discovered patterns as candidates for review.

**Ref:** [specs/knowledge-graph-mcp.md](../specs/knowledge-graph-mcp.md)

**Depends on:** Plan 06

---

## Files to Create

- `services/knowledge-graph/src/knowledge_graph_mcp/tools/learning.py`
- `services/knowledge-graph/tests/test_learning.py`

---

## Steps

- [ ] **Step 1: Write failing test**

```python
# services/knowledge-graph/tests/test_learning.py
import json
import pytest
from unittest.mock import AsyncMock
from knowledge_graph_mcp.tools.learning import _propose_knowledge_impl


@pytest.mark.asyncio
async def test_propose_knowledge(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{"id": 1}])
    result = await _propose_knowledge_impl(
        category="business_rules",
        key="state_derivation",
        content="State codes derive from the project number prefix.",
        scope="client:bgc",
        rationale="Discovered during revenue analysis",
        db=mock_db,
        embed_fn=mock_embed,
        project_id="proj",
        location="us-central1",
        tags=["data-model"],
        session_id=5,
    )
    assert result["candidate_id"] == 1
    assert result["status"] == "pending"


@pytest.mark.asyncio
async def test_propose_knowledge_minimal(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{"id": 2}])
    result = await _propose_knowledge_impl(
        category="context",
        key="general-insight",
        content="Some insight",
        scope="global",
        rationale="Good to know",
        db=mock_db,
        embed_fn=mock_embed,
        project_id="proj",
        location="us-central1",
    )
    assert result["candidate_id"] == 2


@pytest.mark.asyncio
async def test_propose_knowledge_with_tags(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{"id": 3}])
    result = await _propose_knowledge_impl(
        category="query_patterns",
        key="connection-pooling",
        content="Read-only replicas should use connection pooling",
        scope="global",
        rationale="Best practice",
        db=mock_db,
        embed_fn=mock_embed,
        project_id="proj",
        location="us-central1",
        tags=["database", "best-practice"],
    )
    # Verify tags were passed to DB
    call_args = mock_db.query.call_args
    assert ["database", "best-practice"] in call_args[0][1]
```

- [ ] **Step 2: Write implementation**

```python
# services/knowledge-graph/src/knowledge_graph_mcp/tools/learning.py
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
```

Verify: `pytest services/knowledge-graph/tests/test_learning.py -v` → 3 passed

- [ ] **Step 3: Commit**

```bash
git add services/knowledge-graph/src/knowledge_graph_mcp/tools/learning.py services/knowledge-graph/tests/test_learning.py
git commit -m "feat: add propose_knowledge tool for knowledge candidate submission"
```
