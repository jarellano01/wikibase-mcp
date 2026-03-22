# Reporting MCP — Design Spec

A generic, open-source MCP server for executing SQL and Python against any read-only Postgres database, with file upload, data staging, and report history tracking.

---

## Tools — 6 total

### Querying & Analysis

| Tool | Purpose | DB |
|------|---------|-----|
| **`run_query`** | Execute read-only SQL against the target database. SELECT-only, 30s timeout, 10K row limit. Returns JSON. | Target DB (read) |
| **`run_analysis`** | Execute Python code with pre-configured DB connections (`target_engine`, `neon_engine`). Full access to pandas, numpy, sklearn, matplotlib. Returns text + base64 images. 60s timeout. Isolated per-request subprocess. | Target DB + Shared DB (read) |

### File Upload & Staging

| Tool | Purpose | DB |
|------|---------|-----|
| **`upload_file`** | Accept Excel/CSV file. Parse with pandas, return preview (headers, first 20 rows, dtypes, sheet names). | — |
| **`stage_data`** | Create a temp table from Claude's parsed interpretation of uploaded file. Claude specifies columns, types, rows to keep. 24hr TTL. | Shared DB (write) |

### Report History

| Tool | Purpose | DB |
|------|---------|-----|
| **`save_report`** | Log a completed report — question, SQL, Python code, output. Audit trail for re-running. | Shared DB (write) |
| **`list_reports`** | List recent reports, optionally filtered by keyword search on question/output. | Shared DB (read) |

---

## Configuration

| Env Var | Required | Purpose |
|---------|----------|---------|
| `TARGET_DATABASE_URL` | Yes | Read-only Postgres replica to query |
| `DATABASE_URL` | Yes | Shared MCP Postgres (staging + history) |
| `API_KEY` | Yes | Client authentication |

---

## Data Model (schema: `reporting`)

### `reporting.staged_uploads`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | |
| `file_name` | text | Original file name |
| `table_name` | text | Staging table name (e.g., `staged_abc123`) |
| `columns` | jsonb | Column names and types |
| `row_count` | int | Rows staged |
| `created_at` | timestamptz | |
| `expires_at` | timestamptz | Auto-cleanup after 24hrs |

### `reporting.report_history`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | |
| `question` | text NOT NULL | The natural language question |
| `sql_queries` | jsonb DEFAULT '[]' | SQL statements executed |
| `python_code` | text | Python code executed (if any) |
| `output` | text | The formatted report |
| `created_at` | timestamptz DEFAULT NOW() | |

Simple flat audit log — no sessions, no embeddings. Keyword search via ILIKE.

---

## File Upload Flow

```
User provides spreadsheet
    │
    ▼
reporting.upload_file
    → pandas reads file → returns preview
    │
    ▼
Claude examines preview
    → identifies structure, decides what to keep
    │
    ▼
reporting.stage_data
    → creates temp table in shared DB (24hr TTL)
    │
    ▼
reporting.run_query or run_analysis
    → joins staged table with target DB data
```

---

## Security

- **Auth**: Bearer token via AuthMiddleware (from mcp-shared)
- **SQL guardrails**: SELECT-only validation, single statement, 30s timeout, 10K row limit
- **Python sandboxing**: Subprocess with 60s timeout, no filesystem write outside `/tmp`
- **Schema isolation**: All staging tables in `reporting.*` schema

---

## Cloud Run

- Memory: 1GB, Timeout: 300s, Concurrency: 1, Min: 0, Max: 1

---

## Client Configuration

```json
{
  "mcpServers": {
    "reporting": {
      "url": "https://reporting-mcp-xxxxxxxx.run.app/sse",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

---

## Future Considerations (Not in v1)

- Scheduled reports via Cloud Scheduler
- Result caching for frequent queries
- Additional database support (MySQL, BigQuery)
- Web dashboard for browsing report history
