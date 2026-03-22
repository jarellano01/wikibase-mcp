# Architecture Spec

## Monorepo Structure

```
ai-mcp/
├── services/
│   ├── reporting/                    # Reporting MCP (6 tools)
│   │   ├── src/reporting_mcp/
│   │   ├── alembic/                  # Migrations for reporting.* schema
│   │   ├── tests/
│   │   ├── Dockerfile
│   │   └── pyproject.toml
│   └── knowledge-graph/              # Knowledge Graph MCP (7 tools)
│       ├── src/knowledge_graph/
│       ├── alembic/                  # Migrations for knowledge_graph.* schema
│       ├── tests/
│       ├── Dockerfile
│       └── pyproject.toml
├── packages/
│   └── shared/                       # mcp-shared: auth, db, migrations
│       ├── src/mcp_shared/
│       ├── tests/
│       └── pyproject.toml
├── scripts/
│   └── seed_knowledge.py
├── .github/workflows/
│   ├── deploy-mcp-service.yml        # Reusable deployment template
│   ├── reporting.yml
│   └── knowledge-graph.yml
├── docker-compose.yml
├── pyproject.toml                    # uv workspace root
├── .env.example
├── .gitignore
└── LICENSE (MIT)
```

Managed with **uv workspaces**. Each service and package is a standalone Python package. Workspace deps use `mcp-shared = { workspace = true }` in `[tool.uv.sources]`.

---

## Shared Postgres — Schema Isolation

Both services connect to the **same Postgres database** but use separate schemas:

```
DATABASE_URL = postgresql://user:pass@host:5432/ai_mcp
  ├── reporting.*            — owned by reporting service
  │   ├── staged_uploads
  │   └── report_history
  └── knowledge_graph.*      — owned by knowledge graph service
      ├── knowledge_base
      ├── sessions
      ├── session_entries
      └── knowledge_candidates
```

**Why schema isolation instead of separate databases:**
- Users deploy one Postgres instance, not two
- Simpler connection management (one `DATABASE_URL`)
- Each service still fully owns its tables — no cross-schema queries
- Open-source friendly — works with Neon free tier (1 database) or any Postgres

**How it works:**
- Each service sets `search_path` to its schema on connection
- Alembic manages migrations per-schema independently
- The `pgvector` extension is installed in `public` schema (shared)

### Environment Variables

| Var | Used by | Purpose |
|-----|---------|---------|
| `DATABASE_URL` | Both | Shared Postgres (schema-isolated) |
| `TARGET_DATABASE_URL` | Reporting only | Read-only Postgres replica to query |
| `API_KEY` | Both | Bearer token auth |
| `GCP_PROJECT_ID` | KG only | Vertex AI embeddings |
| `GCP_LOCATION` | KG only | GCP region (default: us-central1) |

---

## Auto-Migrations with Alembic

Each service embeds Alembic and runs migrations on startup — **before** registering MCP tools.

### How it works

1. User deploys a new Docker image version
2. Container starts → `startup()` is called
3. `startup()` runs `alembic upgrade head` against the service's schema
4. If already at latest, Alembic is a no-op (fast)
5. MCP tools register and server starts accepting connections

### Migration design rules

- **Always backwards-compatible** — add columns with defaults, never drop columns in the same release
- **One migration per schema change** — generated with `alembic revision --autogenerate`
- **Schema-scoped** — each service's `alembic.ini` sets `version_table_schema` to its schema
- **Idempotent** — safe to run multiple times (Alembic tracks applied versions)

### Alembic setup per service

```
services/reporting/
├── alembic.ini
├── alembic/
│   ├── env.py           # Reads DATABASE_URL, sets search_path
│   ├── script.py.mako
│   └── versions/
│       └── 001_initial.py
```

The `env.py` creates the schema if it doesn't exist, then runs migrations within it.

---

## Deployment

### Docker Images

Each service has its own Dockerfile. Build context is the repo root (to access `packages/shared/`).

```bash
docker build -f services/reporting/Dockerfile -t reporting-mcp .
docker build -f services/knowledge-graph/Dockerfile -t knowledge-graph-mcp .
```

Port 8080 (Cloud Run default). Both images are published to GCR or Docker Hub.

### Cloud Run

| Service | Memory | Timeout | Concurrency | Min | Max |
|---------|--------|---------|-------------|-----|-----|
| reporting-mcp | 1 GB | 300s | 1 | 0 | 1 |
| knowledge-graph-mcp | 512 MB | 60s | 1 | 0 | 1 |

### GitHub Actions

Reusable workflow template (`.github/workflows/deploy-mcp-service.yml`) with caller workflows per service. Uses Workload Identity Federation — no static GCP keys.

### Authentication

Bearer token in `Authorization` header. Validated by `AuthMiddleware` from `mcp-shared`. `/health` endpoint bypasses auth.

---

## Local Development

```yaml
# docker-compose.yml
services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: ai-mcp-db
    ports:
      - "5433:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: ai_mcp
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

Local connection: `postgresql://postgres:postgres@localhost:5433/ai_mcp`
