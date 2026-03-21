# Plan 01 — Monorepo Scaffolding

**Goal:** Create the `ai-mcp` monorepo root with uv workspace config, docker-compose, gitignore, and license.

**Ref:** [specs/architecture.md](../specs/architecture.md)

---

## Files to Create

- `pyproject.toml` (workspace root)
- `.gitignore`
- `.env.example`
- `docker-compose.yml`
- `LICENSE`

---

## Steps

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p services/reporting/src/reporting_mcp/tools
mkdir -p services/reporting/tests
mkdir -p services/reporting/alembic/versions
mkdir -p services/knowledge-graph/src/knowledge_graph_mcp/tools
mkdir -p services/knowledge-graph/tests
mkdir -p services/knowledge-graph/alembic/versions
mkdir -p packages/shared/src/mcp_shared
mkdir -p packages/shared/tests
mkdir -p scripts
mkdir -p .github/workflows
```

- [ ] **Step 2: Write root pyproject.toml (uv workspace config)**

```toml
[project]
name = "ai-mcp"
version = "0.1.0"
requires-python = ">=3.12"

[tool.uv.workspace]
members = ["services/*", "packages/*"]
```

- [ ] **Step 3: Write .gitignore**

```gitignore
# Python
__pycache__/
*.py[cod]
*$py.class
*.egg-info/
dist/
build/

# Virtual environments
.venv/
venv/

# Environment
.env

# Type checking
.mypy_cache/

# Testing
.pytest_cache/
htmlcov/
.coverage

# IDE
.vscode/
.idea/

# OS
.DS_Store

# uv
uv.lock
```

- [ ] **Step 4: Write .env.example**

```env
# Shared Postgres (both services use schemas within this DB)
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/ai_mcp

# Reporting MCP — read-only target database
TARGET_DATABASE_URL=postgresql://user:pass@host:5432/your_database

# API keys (one per service, or shared)
API_KEY=your-api-key-here

# Knowledge Graph MCP — Vertex AI embeddings
GCP_PROJECT_ID=your-gcp-project
GCP_LOCATION=us-central1

# Local dev database (docker-compose)
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=ai_mcp
```

- [ ] **Step 5: Write docker-compose.yml**

```yaml
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

- [ ] **Step 6: Write LICENSE (MIT)**

```text
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml .gitignore .env.example docker-compose.yml LICENSE
git commit -m "feat: scaffold ai-mcp monorepo with uv workspace config"
```
