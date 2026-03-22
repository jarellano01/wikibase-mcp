# Plan 12 — Knowledge Base Seeding Script

**Goal:** Build a script to populate the knowledge base from markdown files at deploy time.

**Ref:** [specs/knowledge-graph-mcp.md](../specs/knowledge-graph-mcp.md) (Knowledge Lifecycle — Phase 1)

**Depends on:** Plan 06

---

## Files to Create

- `scripts/seed_knowledge.py`
- `scripts/tests/test_seed.py`

---

## Steps

- [ ] **Step 1: Write failing test**

```python
# scripts/tests/test_seed.py
import pytest
from unittest.mock import AsyncMock, patch
from seed_knowledge import parse_markdown, slugify_key


def test_parse_markdown_splits_by_h2():
    md = """# Title

Some intro.

## Section One

Content one.

## Section Two

Content two.
"""
    sections = parse_markdown(md)
    assert len(sections) == 2
    assert sections[0]["header"] == "Section One"
    assert "Content one." in sections[0]["content"]
    assert sections[1]["header"] == "Section Two"


def test_parse_markdown_no_sections():
    md = "Just plain text, no headers."
    sections = parse_markdown(md)
    assert len(sections) == 1  # Entire file as one entry
    assert sections[0]["header"] == "content"


def test_slugify_key():
    assert slugify_key("business-rules.md", "State Code Derivation") == "business-rules/state-code-derivation"
    assert slugify_key("schema.md", "Users Table") == "schema/users-table"
```

- [ ] **Step 2: Write implementation**

```python
# scripts/seed_knowledge.py
"""Seed the knowledge base from markdown files.

Usage:
  SEED_DIR=./docs DATABASE_URL=postgresql://... GCP_PROJECT_ID=proj python scripts/seed_knowledge.py

Optional:
  CATEGORY_MAP='{"business-rules.md": "business_rules", "schema.md": "schema"}'
  SEED_SCOPE=global  (default: global)
  SEED_TAGS=best-practice,reference  (comma-separated default tags)
"""

import asyncio
import json
import os
import re
import sys
from pathlib import Path

import asyncpg


def slugify_key(filename: str, header: str) -> str:
    """Create a unique key from filename + section header."""
    base = filename.rsplit(".", 1)[0]
    slug = re.sub(r"[^a-z0-9]+", "-", header.lower()).strip("-")
    return f"{base}/{slug}"


def parse_markdown(text: str) -> list[dict]:
    """Split markdown by ## headers. Returns list of {header, content}."""
    sections = []
    current_header = None
    current_lines = []

    for line in text.split("\n"):
        if line.startswith("## "):
            if current_header is not None:
                sections.append({
                    "header": current_header,
                    "content": "\n".join(current_lines).strip(),
                })
            current_header = line[3:].strip()
            current_lines = []
        elif current_header is not None:
            current_lines.append(line)

    # Last section
    if current_header is not None:
        sections.append({
            "header": current_header,
            "content": "\n".join(current_lines).strip(),
        })

    # If no ## headers found, treat entire file as one entry
    if not sections:
        sections.append({
            "header": "content",
            "content": text.strip(),
        })

    return sections


def get_category(filename: str, category_map: dict) -> str:
    """Look up category from filename. Supports glob-like patterns."""
    for pattern, category in category_map.items():
        if pattern == filename:
            return category
        if pattern.startswith("*") and filename.endswith(pattern[1:]):
            return category
    return "context"


async def embed_texts(texts: list[str], project_id: str, location: str) -> list[list[float]]:
    """Batch embed texts via Vertex AI."""
    from google.cloud import aiplatform
    from vertexai.language_models import TextEmbeddingModel

    aiplatform.init(project=project_id, location=location)
    model = TextEmbeddingModel.from_pretrained("text-embedding-005")

    # Vertex AI has a batch limit of ~250 texts
    all_embeddings = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        embeddings = model.get_embeddings(batch)
        all_embeddings.extend([e.values for e in embeddings])
    return all_embeddings


async def seed(
    seed_dir: str,
    database_url: str,
    project_id: str,
    location: str = "us-central1",
    category_map: dict | None = None,
    scope: str = "global",
    tags: list[str] | None = None,
):
    """Main seeding function."""
    category_map = category_map or {}
    tags = tags or []
    seed_path = Path(seed_dir)

    # Collect all sections from all .md files
    entries = []
    for md_file in sorted(seed_path.rglob("*.md")):
        rel_path = str(md_file.relative_to(seed_path))
        filename = md_file.name
        text = md_file.read_text()
        category = get_category(filename, category_map)

        for section in parse_markdown(text):
            key = slugify_key(filename, section["header"])
            entries.append({
                "key": key,
                "category": category,
                "content": section["content"],
                "scope": scope,
                "tags": tags,
                "source": "seed",
                "source_file": rel_path,
            })

    if not entries:
        print("No markdown sections found.")
        return

    print(f"Found {len(entries)} sections from {len(list(seed_path.rglob('*.md')))} files")

    # Embed all content
    print("Embedding...")
    texts = [e["content"] for e in entries]
    embeddings = await embed_texts(texts, project_id, location)

    # Upsert into knowledge_base
    print("Upserting into knowledge_base...")
    conn = await asyncpg.connect(database_url)
    try:
        await conn.execute("CREATE SCHEMA IF NOT EXISTS knowledge_graph")
        await conn.execute("SET search_path TO knowledge_graph,public")

        for entry, embedding in zip(entries, embeddings):
            await conn.execute(
                """INSERT INTO knowledge_base (category, key, content, embedding, scope, tags, source, source_file)
                   VALUES ($1, $2, $3, $4::vector, $5, $6::text[], $7, $8)
                   ON CONFLICT (key) DO UPDATE
                   SET content = $3, embedding = $4::vector, scope = $5, tags = $6::text[],
                       source = $7, source_file = $8, updated_at = NOW()""",
                entry["category"], entry["key"], entry["content"],
                str(embedding), entry["scope"], entry["tags"],
                entry["source"], entry["source_file"],
            )
            print(f"  ✓ {entry['key']}")
    finally:
        await conn.close()

    print(f"Done. Seeded {len(entries)} entries.")


if __name__ == "__main__":
    seed_dir = os.environ.get("SEED_DIR")
    database_url = os.environ.get("DATABASE_URL")
    project_id = os.environ.get("GCP_PROJECT_ID")
    location = os.environ.get("GCP_LOCATION", "us-central1")
    category_map_str = os.environ.get("CATEGORY_MAP", "{}")
    scope = os.environ.get("SEED_SCOPE", "global")
    tags_str = os.environ.get("SEED_TAGS", "")

    if not all([seed_dir, database_url, project_id]):
        print("Required: SEED_DIR, DATABASE_URL, GCP_PROJECT_ID")
        sys.exit(1)

    category_map = json.loads(category_map_str)
    tags = [t.strip() for t in tags_str.split(",") if t.strip()]

    asyncio.run(seed(seed_dir, database_url, project_id, location, category_map, scope, tags))
```

Verify: `pytest scripts/tests/test_seed.py -v` → 3 passed

- [ ] **Step 3: Commit**

```bash
git add scripts/seed_knowledge.py scripts/tests/
git commit -m "feat: add knowledge base seeding script for populating from markdown files"
```
