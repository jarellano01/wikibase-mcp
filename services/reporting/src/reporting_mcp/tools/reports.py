"""save_report and list_reports tools — report history in reporting schema."""

import json
from typing import Any
from reporting_mcp.db import DatabaseManager


async def _save_report_impl(question: str, sql_queries: list[str], output: str, db: DatabaseManager, tags: list[str] | None = None) -> dict[str, Any]:
    rows = await db.reporting_query(
        """INSERT INTO report_history (question, sql_queries, output, tags)
           VALUES ($1, $2::jsonb, $3, $4::text[])
           RETURNING id""",
        [question, json.dumps(sql_queries), output, tags or []],
    )
    return {"report_id": rows[0]["id"]}


async def _list_reports_impl(search: str | None, db: DatabaseManager, limit: int = 20) -> list[dict]:
    if search:
        return await db.reporting_query(
            "SELECT id, question, output, tags, created_at FROM report_history WHERE question ILIKE $1 ORDER BY created_at DESC LIMIT $2",
            [f"%{search}%", limit],
        )
    return await db.reporting_query(
        "SELECT id, question, output, tags, created_at FROM report_history ORDER BY created_at DESC LIMIT $1",
        [limit],
    )


def register_report_tools(mcp, get_db):
    import json

    @mcp.tool()
    async def save_report(question: str, sql_queries: list[str], output: str, tags: list[str] | None = None) -> str:
        """Save a completed report to history for future reference."""
        return json.dumps(await _save_report_impl(question, sql_queries, output, get_db(), tags), default=str)

    @mcp.tool()
    async def list_reports(search: str | None = None, limit: int = 20) -> str:
        """Search past reports by keyword (ILIKE). Returns recent reports if no search term."""
        return json.dumps(await _list_reports_impl(search, get_db(), limit), default=str)
