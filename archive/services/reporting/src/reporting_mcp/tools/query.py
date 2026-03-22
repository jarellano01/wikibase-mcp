"""run_query tool — execute read-only SQL against the target database."""

from typing import Any
from reporting_mcp.db import DatabaseManager

MAX_ROWS = 10_000


async def _run_query_impl(sql: str, db: DatabaseManager) -> dict[str, Any]:
    try:
        db._validate_select(sql)
    except ValueError as e:
        return {"error": str(e)}
    try:
        rows = await db.target_query(sql, timeout=30.0)
    except Exception as e:
        return {"error": f"Query failed: {e}"}
    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]
    return {"rows": rows, "row_count": len(rows), "truncated": truncated}


def register_query_tools(mcp, get_db):
    import json

    @mcp.tool()
    async def run_query(sql: str) -> str:
        """Execute read-only SQL against the target database. SELECT-only, 30s timeout, 10K row limit."""
        return json.dumps(await _run_query_impl(sql, get_db()), default=str)
