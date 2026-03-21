"""upload_file and stage_data tools — file parsing and staging."""

import hashlib
import time
import json
from typing import Any
import pandas as pd
from reporting_mcp.db import DatabaseManager


def _upload_file_impl(file_path: str) -> dict[str, Any]:
    name = file_path.rsplit("/", 1)[-1] if "/" in file_path else file_path
    if name.endswith((".xlsx", ".xls")):
        xl = pd.ExcelFile(file_path)
        df = xl.parse(xl.sheet_names[0])
        sheets = xl.sheet_names
    else:
        df = pd.read_csv(file_path)
        sheets = None
    result = {
        "file_name": name,
        "headers": list(df.columns),
        "dtypes": {c: str(d) for c, d in df.dtypes.items()},
        "row_count": len(df),
        "preview": df.head(20).to_dict(orient="records"),
    }
    if sheets:
        result["sheet_names"] = sheets
    return result


async def _stage_data_impl(columns: dict[str, str], rows: list[list], file_name: str, db: DatabaseManager) -> dict[str, Any]:
    suffix = hashlib.md5(f"{file_name}{time.time()}".encode()).hexdigest()[:8]
    table_name = f"staged_{suffix}"
    col_defs = ", ".join(f'"{c}" {t}' for c, t in columns.items())
    await db.reporting_execute(f'CREATE TABLE "{table_name}" ({col_defs})')
    col_names = list(columns.keys())
    placeholders = ", ".join(f"${i+1}" for i in range(len(col_names)))
    for row in rows:
        await db.reporting_execute(
            f'INSERT INTO "{table_name}" ({", ".join(col_names)}) VALUES ({placeholders})', row
        )
    await db.reporting_query(
        "INSERT INTO staged_uploads (file_name, table_name, columns, row_count) VALUES ($1, $2, $3::jsonb, $4) RETURNING id",
        [file_name, table_name, json.dumps(columns), len(rows)],
    )
    return {"table_name": table_name, "row_count": len(rows), "columns": columns}


def register_upload_tools(mcp, get_db):
    import json

    @mcp.tool()
    async def upload_file(file_path: str) -> str:
        """Parse Excel/CSV file, return preview (headers, 20 rows, dtypes, sheet names)."""
        return json.dumps(_upload_file_impl(file_path), default=str)

    @mcp.tool()
    async def stage_data(columns: dict[str, str], rows: list[list], file_name: str) -> str:
        """Create a temp table from parsed file data. Expires after 24 hours."""
        return json.dumps(await _stage_data_impl(columns, rows, file_name, get_db()))
