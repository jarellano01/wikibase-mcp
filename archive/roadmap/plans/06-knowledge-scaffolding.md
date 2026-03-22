# Plan 06 — Knowledge Graph Service Scaffolding

**Goal:** Create the knowledge graph service package with config, NeonDB, Vertex AI embeddings, and Alembic setup in `knowledge_graph.*` schema.

**Ref:** [specs/knowledge-graph-mcp.md](../specs/knowledge-graph-mcp.md), [specs/architecture.md](../specs/architecture.md)

**Depends on:** Plan 01, Plan 02

---

## Files to Create

- `services/knowledge-graph/pyproject.toml`
- `services/knowledge-graph/src/knowledge_graph_mcp/__init__.py`
- `services/knowledge-graph/src/knowledge_graph_mcp/config.py`
- `services/knowledge-graph/src/knowledge_graph_mcp/db.py`
- `services/knowledge-graph/src/knowledge_graph_mcp/embeddings.py`
- `services/knowledge-graph/tests/conftest.py`
- `services/knowledge-graph/tests/test_config.py`
- `services/knowledge-graph/tests/test_embeddings.py`
- `services/knowledge-graph/alembic.ini`
- `services/knowledge-graph/alembic/env.py`
- `services/knowledge-graph/alembic/versions/.gitkeep`

---

## Steps

- [ ] **Step 1: Write pyproject.toml**

```toml
[project]
name = "knowledge-graph-mcp"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
    "mcp-shared",
    "mcp>=1.0.0",
    "asyncpg>=0.30.0",
    "google-cloud-aiplatform>=1.40.0",
    "uvicorn>=0.27.0",
    "starlette>=0.36.0",
    "python-dotenv>=1.0.0",
    "alembic>=1.13.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "pytest-asyncio>=0.23.0",
    "pytest-cov>=4.1.0",
]

[tool.uv.sources]
mcp-shared = { workspace = true }

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.pytest.ini_options]
asyncio_mode = "auto"
testpaths = ["tests"]
```

- [ ] **Step 2: Write config.py (TDD — test first)**

```python
# services/knowledge-graph/tests/test_config.py
import pytest
from knowledge_graph_mcp.config import Settings


def test_settings_loads(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://shared")
    monkeypatch.setenv("API_KEY", "test")
    monkeypatch.setenv("GCP_PROJECT_ID", "my-project")
    s = Settings()
    assert s.database_url == "postgresql://shared"
    assert s.gcp_location == "us-central1"  # default


def test_settings_missing_raises(monkeypatch):
    for k in ["DATABASE_URL", "API_KEY", "GCP_PROJECT_ID"]:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ValueError):
        Settings()
```

- [ ] **Step 3: Write config.py implementation**

```python
# services/knowledge-graph/src/knowledge_graph_mcp/config.py
"""Application configuration from environment variables."""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_url: str        # Shared PG (knowledge_graph.* schema)
    api_key: str
    gcp_project_id: str
    gcp_location: str

    def __init__(self):
        self.database_url = os.environ.get("DATABASE_URL", "")
        self.api_key = os.environ.get("API_KEY", "")
        self.gcp_project_id = os.environ.get("GCP_PROJECT_ID", "")
        self.gcp_location = os.environ.get("GCP_LOCATION", "us-central1")
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if not self.api_key:
            missing.append("API_KEY")
        if not self.gcp_project_id:
            missing.append("GCP_PROJECT_ID")
        if missing:
            raise ValueError(f"Missing: {', '.join(missing)}")
```

- [ ] **Step 4: Write embeddings.py (TDD — test first)**

```python
# services/knowledge-graph/tests/test_embeddings.py
import pytest
from unittest.mock import patch, MagicMock
from knowledge_graph_mcp.embeddings import embed_text


@pytest.mark.asyncio
async def test_embed_text_returns_768_dims():
    mock_model = MagicMock()
    mock_embedding = MagicMock()
    mock_embedding.values = [0.1] * 768
    mock_model.get_embeddings.return_value = [mock_embedding]

    with patch("knowledge_graph_mcp.embeddings._get_model", return_value=mock_model):
        result = await embed_text("test query", "my-project", "us-central1")
        assert len(result) == 768
```

- [ ] **Step 5: Write embeddings.py implementation**

```python
# services/knowledge-graph/src/knowledge_graph_mcp/embeddings.py
"""Vertex AI text embeddings via text-embedding-005."""

import asyncio
from functools import lru_cache
from google.cloud import aiplatform
from vertexai.language_models import TextEmbeddingModel

MODEL_ID = "text-embedding-005"
DIMENSIONS = 768

_model = None


def _get_model(project_id: str, location: str) -> TextEmbeddingModel:
    global _model
    if _model is None:
        aiplatform.init(project=project_id, location=location)
        _model = TextEmbeddingModel.from_pretrained(MODEL_ID)
    return _model


async def embed_text(text: str, project_id: str, location: str) -> list[float]:
    """Embed a single text string. Returns 768-dimension vector."""
    model = _get_model(project_id, location)
    embeddings = await asyncio.to_thread(model.get_embeddings, [text])
    return embeddings[0].values


async def embed_batch(texts: list[str], project_id: str, location: str) -> list[list[float]]:
    """Embed multiple texts. Returns list of 768-dimension vectors."""
    model = _get_model(project_id, location)
    embeddings = await asyncio.to_thread(model.get_embeddings, texts)
    return [e.values for e in embeddings]
```

- [ ] **Step 6: Write db.py**

```python
# services/knowledge-graph/src/knowledge_graph_mcp/db.py
"""Database wrapper for knowledge graph schema."""

from mcp_shared.db import BaseDB

SCHEMA = "knowledge_graph"


class KnowledgeDB(BaseDB):
    """Knowledge graph database — operates in knowledge_graph.* schema."""

    def __init__(self, url: str):
        super().__init__(url, schema=SCHEMA)
```

- [ ] **Step 7: Write conftest.py**

```python
# services/knowledge-graph/tests/conftest.py
import pytest
from unittest.mock import AsyncMock, MagicMock
from knowledge_graph_mcp.db import KnowledgeDB


@pytest.fixture
def mock_db():
    db = MagicMock(spec=KnowledgeDB)
    db.query = AsyncMock(return_value=[])
    db.execute = AsyncMock(return_value="INSERT 0 1")
    return db


@pytest.fixture
def mock_embed():
    """Returns a mock embed function that produces 768-dim vectors."""
    async def _embed(text, project_id, location):
        return [0.1] * 768
    return _embed
```

- [ ] **Step 8: Set up Alembic for knowledge_graph schema**

Initial migration creates all tables with pgvector extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_graph.knowledge_base (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    embedding vector(768),
    scope TEXT NOT NULL DEFAULT 'global',
    tags TEXT[] DEFAULT '{}',
    source TEXT NOT NULL DEFAULT 'manual',
    source_file TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_kb_scope ON knowledge_graph.knowledge_base(scope);
CREATE INDEX idx_kb_tags ON knowledge_graph.knowledge_base USING gin(tags);

CREATE TABLE knowledge_graph.sessions (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'global',
    user_name TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE knowledge_graph.session_entries (
    id SERIAL PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES knowledge_graph.sessions(id),
    sequence INTEGER NOT NULL,
    entry_type TEXT NOT NULL,
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(session_id, sequence)
);

CREATE TABLE knowledge_graph.knowledge_candidates (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(768),
    rationale TEXT,
    scope TEXT NOT NULL DEFAULT 'global',
    tags TEXT[] DEFAULT '{}',
    session_id INTEGER REFERENCES knowledge_graph.sessions(id),
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by TEXT,
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

- [ ] **Step 9: Install and verify**

```bash
cd ai-mcp && uv sync
pytest services/knowledge-graph/tests/ -v
```

- [ ] **Step 10: Commit**

```bash
git add services/knowledge-graph/
git commit -m "feat: scaffold knowledge graph service with config, DB, embeddings, and Alembic migrations"
```
