# ai-mcp — Roadmap & Implementation Guide

## What This Is

Two independent, open-source Python MCP servers deployed as Docker images:

1. **Reporting MCP** (6 tools) — Execute SQL and Python against any read-only Postgres, upload/stage files, track report history
2. **Knowledge Graph MCP** (7 tools) — Semantic knowledge base with vector search, exploration sessions, and continuous learning

Both share a single Postgres database (schema-isolated) and common infrastructure via `mcp-shared`.

## Architecture at a Glance

```
Claude Desktop
  ├── MCP: reporting        → queries TARGET_DATABASE_URL (read-only replica)
  │                         → stores staging tables + report history in DATABASE_URL (reporting.*)
  └── MCP: knowledge-graph  → stores knowledge + sessions in DATABASE_URL (knowledge_graph.*)

Single Postgres Instance (DATABASE_URL)
  ├── reporting.*           — staged_uploads, report_history
  └── knowledge_graph.*     — knowledge_base, sessions, session_entries, knowledge_candidates
```

- **Schema isolation** — each service owns its own Postgres schema within a shared database
- **Auto-migrations** — Alembic runs on container startup. Upgrade the image, redeploy, migrations apply automatically.
- **Scoped knowledge** — entries belong to `global`, `client:<name>`, or `personal` scope. Tags enable cross-scope discovery.

## For AI Agents — Build Order

Read the specs first for context, then execute plans in numbered order.

### Specs (reference — read before building)

| File | Purpose |
|------|---------|
| [specs/architecture.md](specs/architecture.md) | Monorepo structure, shared Postgres, schema isolation, auto-migrations |
| [specs/shared-package.md](specs/shared-package.md) | `mcp-shared` package: auth middleware, BaseDB, migration runner |
| [specs/reporting-mcp.md](specs/reporting-mcp.md) | Reporting MCP: 6 tools, data model, configuration |
| [specs/knowledge-graph-mcp.md](specs/knowledge-graph-mcp.md) | Knowledge Graph MCP: 7 tools, scope/tags, exploration sessions |
| [specs/system-prompts.md](specs/system-prompts.md) | System prompt examples for Claude Desktop — how the AI agent learns to use the tools |

### Plans (execute in order — each is one focused work unit)

| # | File | What it builds |
|---|------|---------------|
| 01 | [plans/01-monorepo-scaffolding.md](plans/01-monorepo-scaffolding.md) | Root pyproject.toml, docker-compose, .gitignore, LICENSE |
| 02 | [plans/02-shared-package.md](plans/02-shared-package.md) | `mcp-shared`: AuthMiddleware, BaseDB, migration helper |
| 03 | [plans/03-reporting-scaffolding.md](plans/03-reporting-scaffolding.md) | Reporting service: config, DatabaseManager, Alembic setup |
| 04 | [plans/04-reporting-tools.md](plans/04-reporting-tools.md) | run_query, run_analysis, upload_file, stage_data, save_report, list_reports |
| 05 | [plans/05-reporting-server.md](plans/05-reporting-server.md) | Server entry point with auto-migration on startup |
| 06 | [plans/06-knowledge-scaffolding.md](plans/06-knowledge-scaffolding.md) | KG service: config, NeonDB, Vertex AI embeddings |
| 07 | [plans/07-knowledge-tools.md](plans/07-knowledge-tools.md) | get_knowledge, review_knowledge (vector search + scope/tags) |
| 08 | [plans/08-knowledge-sessions.md](plans/08-knowledge-sessions.md) | start_session, add_context, get_session, list_sessions |
| 09 | [plans/09-knowledge-learning.md](plans/09-knowledge-learning.md) | propose_knowledge (flexible categories) |
| 10 | [plans/10-knowledge-server.md](plans/10-knowledge-server.md) | Server entry point with auto-migration on startup |
| 11 | [plans/11-deployment.md](plans/11-deployment.md) | Dockerfiles, reusable GHA workflow, caller workflows |
| 12 | [plans/12-seeding.md](plans/12-seeding.md) | Knowledge base seeding script |

### Execution guidance

- Each plan has `- [ ]` checkboxes. Mark them as you go.
- Plans use TDD: write failing test → verify failure → implement → verify pass → commit.
- Plans reference specs for design decisions. If something is ambiguous, check the relevant spec.
- Plans 01-02 are shared infrastructure. Plans 03-05 are reporting. Plans 06-10 are knowledge graph. Plans 11-12 are deployment.
- You can parallelize reporting (03-05) and knowledge graph (06-10) after completing shared infrastructure (01-02).

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Language | Python 3.12 |
| Monorepo | uv workspaces |
| MCP SDK | `mcp` (FastMCP) |
| Database | Postgres with `pgvector` (single instance, schema-isolated) |
| Migrations | Alembic (auto-run on startup) |
| Embeddings | Vertex AI `text-embedding-005` (768 dims) — KG only |
| HTTP | `uvicorn` + `starlette` |
| Deployment | Docker → Cloud Run via GitHub Actions (Workload Identity Federation) |
| CI/CD | Reusable GHA workflow template |

## Quick Start (for users deploying)

1. Run a Postgres instance with `pgvector` extension (or use Neon free tier)
2. Pull Docker images and set `DATABASE_URL`
3. Start containers — migrations auto-apply on first boot
4. Configure Claude Desktop with MCP server URLs + API keys
5. (KG only) Seed knowledge base from your markdown files
