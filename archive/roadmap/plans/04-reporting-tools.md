# Plan 04 — Reporting Tools

**Goal:** Implement all 6 reporting MCP tools: `run_query`, `run_analysis`, `upload_file`, `stage_data`, `save_report`, `list_reports`.

**Ref:** [specs/reporting-mcp.md](../specs/reporting-mcp.md)

**Depends on:** Plan 03

---

## Files to Create

- `services/reporting/src/reporting_mcp/tools/__init__.py`
- `services/reporting/src/reporting_mcp/tools/query.py`
- `services/reporting/src/reporting_mcp/tools/analysis.py`
- `services/reporting/src/reporting_mcp/tools/upload.py`
- `services/reporting/src/reporting_mcp/tools/reports.py`
- `services/reporting/tests/test_query.py`
- `services/reporting/tests/test_analysis.py`
- `services/reporting/tests/test_upload.py`
- `services/reporting/tests/test_reports.py`

---

## Steps

### run_query

- [ ] **Step 1: Write failing test**

```python
# services/reporting/tests/test_query.py
import pytest
from unittest.mock import AsyncMock
from reporting_mcp.tools.query import _run_query_impl


@pytest.mark.asyncio
async def test_run_query_returns_results(mock_db):
    mock_db.target_query = AsyncMock(return_value=[{"state": "AZ", "count": 42}])
    result = await _run_query_impl("SELECT 1", mock_db)
    assert result["row_count"] == 1


@pytest.mark.asyncio
async def test_run_query_rejects_non_select(mock_db):
    result = await _run_query_impl("DELETE FROM users", mock_db)
    assert "error" in result


@pytest.mark.asyncio
async def test_run_query_enforces_row_limit(mock_db):
    mock_db.target_query = AsyncMock(return_value=[{"i": i} for i in range(10001)])
    result = await _run_query_impl("SELECT * FROM big", mock_db)
    assert result["row_count"] == 10000
    assert result["truncated"] is True
```

- [ ] **Step 2: Write implementation**

```python
# services/reporting/src/reporting_mcp/tools/query.py
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
```

Verify: `pytest services/reporting/tests/test_query.py -v` → 3 passed

### run_analysis

- [ ] **Step 3: Write failing test**

```python
# services/reporting/tests/test_analysis.py
import pytest
from reporting_mcp.tools.analysis import _run_analysis_impl


@pytest.mark.asyncio
async def test_simple_code():
    result = await _run_analysis_impl("print(2+2)", "postgresql://fake", "postgresql://fake")
    assert "4" in result["stdout"]


@pytest.mark.asyncio
async def test_timeout():
    result = await _run_analysis_impl(
        "import time; time.sleep(120)", "postgresql://fake", "postgresql://fake", timeout=2
    )
    assert result["error"] is not None
```

- [ ] **Step 4: Write implementation**

```python
# services/reporting/src/reporting_mcp/tools/analysis.py
"""run_analysis tool — execute Python code in a sandboxed subprocess."""

import asyncio
import base64
import os
import tempfile
import textwrap
from typing import Any

PREAMBLE = textwrap.dedent("""\
    import os, pandas as pd, numpy as np, json, matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from sqlalchemy import create_engine, text
    target_engine = create_engine(os.environ['_TARGET_URL'])
    reporting_engine = create_engine(os.environ['_REPORTING_URL'])
""")


async def _run_analysis_impl(code: str, target_url: str, reporting_url: str, timeout: int = 60) -> dict[str, Any]:
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False) as f:
        f.write(PREAMBLE + "\n" + code)
        script_path = f.name
    env = os.environ.copy()
    env["_TARGET_URL"] = target_url
    env["_REPORTING_URL"] = reporting_url
    try:
        proc = await asyncio.create_subprocess_exec(
            "python", script_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            return {"stdout": "", "stderr": "", "images": [], "error": f"Timed out after {timeout}s"}
        images = []
        for i in range(20):
            p = f"/tmp/mcp_plot_{i}.png"
            if os.path.exists(p):
                with open(p, "rb") as img:
                    images.append(base64.b64encode(img.read()).decode())
                os.remove(p)
        return {
            "stdout": stdout.decode(),
            "stderr": stderr.decode(),
            "images": images,
            "error": stderr.decode() if proc.returncode != 0 else None,
        }
    finally:
        os.unlink(script_path)


def register_analysis_tools(mcp, get_db, get_settings):
    import json

    @mcp.tool()
    async def run_analysis(code: str) -> str:
        """Execute Python with pre-configured DB connections (target_engine, reporting_engine). pandas, numpy, sklearn, matplotlib available. 60s timeout."""
        s = get_settings()
        return json.dumps(await _run_analysis_impl(code, s.target_database_url, s.database_url))
```

Verify: `pytest services/reporting/tests/test_analysis.py -v` → 2 passed

### upload_file + stage_data

- [ ] **Step 5: Write failing test**

```python
# services/reporting/tests/test_upload.py
import pytest
from unittest.mock import AsyncMock
from reporting_mcp.tools.upload import _upload_file_impl, _stage_data_impl


def test_upload_csv(tmp_path):
    f = tmp_path / "test.csv"
    f.write_text("name,age\nAlice,30\nBob,25\n")
    result = _upload_file_impl(str(f))
    assert result["headers"] == ["name", "age"]
    assert len(result["preview"]) == 2


@pytest.mark.asyncio
async def test_stage_data(mock_db):
    mock_db.reporting_execute = AsyncMock(return_value="CREATE TABLE")
    mock_db.reporting_query = AsyncMock(return_value=[{"id": 1}])
    result = await _stage_data_impl(
        {"name": "TEXT", "age": "INTEGER"}, [["Alice", 30]], "test.csv", mock_db
    )
    assert result["table_name"].startswith("staged_")
    assert result["row_count"] == 1
```

- [ ] **Step 6: Write implementation**

```python
# services/reporting/src/reporting_mcp/tools/upload.py
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
```

Verify: `pytest services/reporting/tests/test_upload.py -v` → 2 passed

### save_report + list_reports

- [ ] **Step 7: Write failing test**

```python
# services/reporting/tests/test_reports.py
import pytest
from unittest.mock import AsyncMock
from reporting_mcp.tools.reports import _save_report_impl, _list_reports_impl


@pytest.mark.asyncio
async def test_save_report(mock_db):
    mock_db.reporting_query = AsyncMock(return_value=[{"id": 1}])
    result = await _save_report_impl("What is revenue?", ["SELECT sum(amount) FROM invoices"], "Total: $1M", mock_db)
    assert result["report_id"] == 1


@pytest.mark.asyncio
async def test_list_reports(mock_db):
    mock_db.reporting_query = AsyncMock(return_value=[
        {"id": 1, "question": "Revenue?", "created_at": "2026-03-10"},
    ])
    result = await _list_reports_impl(None, mock_db)
    assert len(result) == 1
```

- [ ] **Step 8: Write implementation**

```python
# services/reporting/src/reporting_mcp/tools/reports.py
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
```

Verify: `pytest services/reporting/tests/test_reports.py -v` → 2 passed

- [ ] **Step 9: Commit**

```bash
git add services/reporting/src/reporting_mcp/tools/ services/reporting/tests/
git commit -m "feat: add all 6 reporting tools — query, analysis, upload, stage, save_report, list_reports"
```
