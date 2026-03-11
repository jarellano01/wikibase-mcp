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
    seq_rows = await db.query(
        "SELECT MAX(sequence) as max_seq FROM session_entries WHERE session_id = $1",
        [session_id],
    )
    next_seq = (seq_rows[0]["max_seq"] or 0) + 1

    embedding = await embed_fn(content, project_id, location)

    rows = await db.query(
        """INSERT INTO session_entries (session_id, sequence, entry_type, content, metadata, embedding)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6::vector)
           RETURNING id""",
        [session_id, next_seq, entry_type, content, json.dumps(metadata or {}), str(embedding)],
    )

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
