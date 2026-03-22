# Plan 08 — Exploration Sessions

**Goal:** Implement `start_session`, `add_context`, `get_session`, and `list_sessions` — the multi-turn exploration workflow.

**Ref:** [specs/knowledge-graph-mcp.md](../specs/knowledge-graph-mcp.md) (Exploration Session Flow section)

**Depends on:** Plan 06

---

## Files to Create

- `services/knowledge-graph/src/knowledge_graph_mcp/tools/sessions.py`
- `services/knowledge-graph/tests/test_sessions.py`

---

## Steps

- [ ] **Step 1: Write failing tests**

```python
# services/knowledge-graph/tests/test_sessions.py
import json
import pytest
from unittest.mock import AsyncMock
from knowledge_graph_mcp.tools.sessions import (
    _start_session_impl,
    _add_context_impl,
    _get_session_impl,
    _list_sessions_impl,
)


@pytest.mark.asyncio
async def test_start_session(mock_db):
    mock_db.query = AsyncMock(return_value=[{"id": 1}])
    result = await _start_session_impl("Review dbt framework", "client:bgc", mock_db, user_name="jon")
    assert result["session_id"] == 1
    assert result["scope"] == "client:bgc"


@pytest.mark.asyncio
async def test_add_context(mock_db, mock_embed):
    mock_db.query = AsyncMock(side_effect=[
        [{"max_seq": 2}],  # get current max sequence
        [{"id": 5}],  # insert returns id
    ])
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _add_context_impl(1, "observation", "Merge keys are wrong", mock_db, mock_embed, "proj", "us-central1")
    assert result["sequence"] == 3  # next after max 2


@pytest.mark.asyncio
async def test_add_context_first_entry(mock_db, mock_embed):
    mock_db.query = AsyncMock(side_effect=[
        [{"max_seq": None}],  # no entries yet
        [{"id": 1}],
    ])
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _add_context_impl(1, "question", "What is this?", mock_db, mock_embed, "proj", "us-central1")
    assert result["sequence"] == 1


@pytest.mark.asyncio
async def test_get_session(mock_db):
    mock_db.query = AsyncMock(side_effect=[
        [{"id": 1, "title": "Test", "scope": "global", "status": "active", "user_name": "jon", "created_at": "2026-03-10", "updated_at": "2026-03-10"}],
        [{"id": 1, "sequence": 1, "entry_type": "question", "content": "Hello", "metadata": {}, "created_at": "2026-03-10"}],
    ])
    result = await _get_session_impl(1, mock_db)
    assert result["session"]["title"] == "Test"
    assert len(result["entries"]) == 1


@pytest.mark.asyncio
async def test_list_sessions(mock_db):
    mock_db.query = AsyncMock(return_value=[
        {"id": 1, "title": "Test", "scope": "global", "status": "active", "entry_count": 3, "created_at": "2026-03-10", "updated_at": "2026-03-10"},
    ])
    result = await _list_sessions_impl(mock_db)
    assert len(result) == 1
```

- [ ] **Step 2: Write implementation**

```python
# services/knowledge-graph/src/knowledge_graph_mcp/tools/sessions.py
"""Exploration session tools — multi-turn context accumulation."""

import json
from typing import Any, Callable, Awaitable
from knowledge_graph_mcp.db import KnowledgeDB


async def _start_session_impl(
    title: str,
    scope: str,
    db: KnowledgeDB,
    user_name: str | None = None,
) -> dict[str, Any]:
    rows = await db.query(
        "INSERT INTO sessions (title, scope, user_name) VALUES ($1, $2, $3) RETURNING id",
        [title, scope, user_name],
    )
    return {"session_id": rows[0]["id"], "scope": scope}


async def _add_context_impl(
    session_id: int,
    entry_type: str,
    content: str,
    db: KnowledgeDB,
    embed_fn: Callable[[str, str, str], Awaitable[list[float]]],
    project_id: str,
    location: str,
    metadata: dict | None = None,
) -> dict[str, Any]:
    # Get next sequence number
    seq_rows = await db.query(
        "SELECT MAX(sequence) as max_seq FROM session_entries WHERE session_id = $1",
        [session_id],
    )
    next_seq = (seq_rows[0]["max_seq"] or 0) + 1

    # Embed the content
    embedding = await embed_fn(content, project_id, location)

    # Insert entry
    rows = await db.query(
        """INSERT INTO session_entries (session_id, sequence, entry_type, content, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)
           RETURNING id""",
        [session_id, next_seq, entry_type, content, json.dumps(metadata or {}), str(embedding)],
    )

    # Update session updated_at
    await db.execute(
        "UPDATE sessions SET updated_at = NOW() WHERE id = $1",
        [session_id],
    )

    return {"entry_id": rows[0]["id"], "sequence": next_seq}


async def _get_session_impl(session_id: int, db: KnowledgeDB) -> dict[str, Any]:
    sessions = await db.query("SELECT * FROM sessions WHERE id = $1", [session_id])
    if not sessions:
        return {"error": f"Session {session_id} not found"}

    entries = await db.query(
        "SELECT id, sequence, entry_type, content, metadata, created_at FROM session_entries WHERE session_id = $1 ORDER BY sequence",
        [session_id],
    )
    return {"session": sessions[0], "entries": entries}


async def _list_sessions_impl(
    db: KnowledgeDB,
    scope: str | None = None,
    status: str | None = None,
    limit: int = 20,
) -> list[dict]:
    conditions = []
    params = []
    param_idx = 1

    if scope:
        conditions.append(f"s.scope = ${param_idx}")
        params.append(scope)
        param_idx += 1

    if status:
        conditions.append(f"s.status = ${param_idx}")
        params.append(status)
        param_idx += 1

    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    params.append(limit)

    return await db.query(
        f"""SELECT s.id, s.title, s.scope, s.status, s.user_name,
                   COUNT(e.id) as entry_count, s.created_at, s.updated_at
            FROM sessions s
            LEFT JOIN session_entries e ON e.session_id = s.id
            {where}
            GROUP BY s.id
            ORDER BY s.updated_at DESC
            LIMIT ${param_idx}""",
        params,
    )


def register_session_tools(mcp, get_db, get_settings, embed_fn):
    @mcp.tool()
    async def start_session(title: str, scope: str = "global", user_name: str | None = None) -> str:
        """Create an exploration session — a multi-turn scratchpad for building toward knowledge entries."""
        result = await _start_session_impl(title, scope, get_db(), user_name=user_name)
        return json.dumps(result, default=str)

    @mcp.tool()
    async def add_context(
        session_id: int,
        entry_type: str,
        content: str,
        metadata: dict | None = None,
    ) -> str:
        """Add a context entry to a session. Types: question, observation, code, reference, note."""
        s = get_settings()
        result = await _add_context_impl(
            session_id, entry_type, content, get_db(), embed_fn,
            s.gcp_project_id, s.gcp_location, metadata=metadata,
        )
        return json.dumps(result, default=str)

    @mcp.tool()
    async def get_session(session_id: int) -> str:
        """Load a session's full context history for resumption."""
        result = await _get_session_impl(session_id, get_db())
        return json.dumps(result, default=str)

    @mcp.tool()
    async def list_sessions(scope: str | None = None, status: str | None = None, limit: int = 20) -> str:
        """List recent sessions, optionally filtered by scope or status."""
        result = await _list_sessions_impl(get_db(), scope=scope, status=status, limit=limit)
        return json.dumps(result, default=str)
```

Verify: `pytest services/knowledge-graph/tests/test_sessions.py -v` → 5 passed

- [ ] **Step 3: Commit**

```bash
git add services/knowledge-graph/src/knowledge_graph_mcp/tools/sessions.py services/knowledge-graph/tests/test_sessions.py
git commit -m "feat: add exploration session tools — start, add_context, get, list"
```
