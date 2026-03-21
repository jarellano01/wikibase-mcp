# Knowledge Graph MCP — Design Spec

A generic, open-source MCP server for semantic knowledge retrieval, exploration sessions, and continuous learning. Works with any domain — seed it with your own markdown files.

---

## Tools — 7 total

### Knowledge & Context

| Tool | Purpose | DB |
|------|---------|-----|
| **`get_knowledge`** | Semantic search over the knowledge base. Embeds query via Vertex AI, returns top-N by cosine similarity. Auto-filters by scope (session scope + global). Optionally filter by category and tags. | Shared DB (read) |
| **`propose_knowledge`** | Submit a discovered pattern/rule as a candidate for review. Includes rationale and optional link to originating session. | Shared DB (write) |
| **`review_knowledge`** | List pending candidates. Approve or reject. Approved entries are embedded and added to `knowledge_base`. | Shared DB (read/write) |

### Exploration Sessions

| Tool | Purpose | DB |
|------|---------|-----|
| **`start_session`** | Create an exploration session — a multi-turn scratchpad for feeding context and building toward knowledge entries. Returns session ID. | Shared DB (write) |
| **`add_context`** | Add a context entry to a session (question, code snippet, observation, external reference). Entries are numbered sequentially. | Shared DB (write) |
| **`get_session`** | Load a session's full context history for resumption. | Shared DB (read) |
| **`list_sessions`** | List recent sessions, optionally filtered by scope or status. | Shared DB (read) |

---

## Tool Details

### `get_knowledge`

```
Args:
  query: str          — Natural language description of what you need
  category: str|None  — Optional filter (see valid categories below)
  scope: str|None     — Filter to specific scope. If omitted and within a session,
                        uses the session's scope + global. Examples: `global`,
                        `client:bgc`, `personal`.
  tags: list[str]|None — Filter to entries matching any of these tags.
  limit: int = 10     — Max entries to return

Returns: JSON array of {id, category, key, content, scope, tags}
```

Embeds the query via Vertex AI, then runs:
```sql
SELECT id, category, key, content, scope, tags
FROM knowledge_base
WHERE (scope = $2 OR scope = 'global')
  AND (category = $3)                   -- only if category filter provided
  AND (tags && $4::text[])              -- only if tags filter provided
ORDER BY embedding <=> $1::vector
LIMIT $5
```

### `propose_knowledge`

```
Args:
  category: str       — Must be a valid category
  key: str            — Unique identifier (e.g., 'az_monsoon_season')
  content: str        — The knowledge entry in markdown
  scope: str          — `global`, `client:<name>`, or `personal`
  tags: list[str]|None — Cross-cutting themes (e.g., ["tech-debt", "best-practice"])
  rationale: str      — Why this should be permanent knowledge
  session_id: int|None — Originating session ID (optional)

Returns: JSON {candidate_id, status: "pending"}
```

Validates category, embeds content, inserts into `knowledge_candidates` as pending.

### `review_knowledge`

```
Args:
  candidate_id: int   — ID of the candidate to review
  action: str         — 'approve' or 'reject'
  reviewer: str       — Name of reviewer

Returns: Confirmation string
```

On approve: embeds candidate content, upserts into `knowledge_base` with source `approved_candidate`, updates candidate status. On reject: updates candidate status only.

### `start_session`

```
Args:
  title: str          — Brief topic description
  scope: str = 'global' — Sets default scope for knowledge queries during session
  user_name: str|None — Who is starting the session

Returns: JSON {session_id, scope}
```

### `add_context`

```
Args:
  session_id: int     — Which session
  entry_type: str     — Type of context: 'question', 'observation', 'code', 'reference', 'note'
  content: str        — The context entry content
  metadata: dict|None — Optional structured metadata (e.g., file paths, URLs)

Returns: JSON {entry_id, sequence}
```

Auto-increments sequence within session. Embeds the content for future semantic search.

### `get_session`

```
Args:
  session_id: int     — Session ID to load

Returns: JSON {session: {...}, entries: [...]}
```

Returns session metadata plus all context entries ordered by sequence.

### `list_sessions`

```
Args:
  scope: str|None     — Filter by scope
  status: str|None    — Filter by status ('active', 'closed')
  limit: int = 20     — Max results

Returns: JSON array of {id, title, scope, status, entry_count, created_at, updated_at}
```

---

## Valid Categories

Categories are flexible — these are the defaults, but the system does not enforce a fixed enum. Users can propose entries with any category string.

| Category | Purpose |
|----------|---------|
| `business_rules` | Domain-specific rules and logic |
| `schema` | Database schema information |
| `query_patterns` | Reusable SQL/query patterns |
| `context` | General domain context and background |
| `people` | Team directory, roles, contacts |
| `definitions` | Terminology and formatting standards |
| `workflows` | Business processes and procedures |

---

## Configuration

| Env Var | Required | Purpose |
|---------|----------|---------|
| `DATABASE_URL` | Yes | Shared MCP Postgres (knowledge_graph.* schema) |
| `API_KEY` | Yes | Client authentication token |
| `GCP_PROJECT_ID` | Yes | Google Cloud project for Vertex AI |
| `GCP_LOCATION` | No | GCP region (default: `us-central1`) |

---

## Data Model (schema: `knowledge_graph`)

### `knowledge_graph.knowledge_base`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | |
| `category` | text NOT NULL | Category string |
| `key` | text NOT NULL UNIQUE | Unique identifier (e.g., `state_derivation`) |
| `content` | text NOT NULL | The knowledge entry in markdown |
| `embedding` | vector(768) | Semantic vector for nearest-neighbor search |
| `scope` | text NOT NULL DEFAULT 'global' | Context boundary — `global`, `client:<name>`, `personal` |
| `tags` | text[] DEFAULT '{}' | Cross-cutting themes for multi-scope discovery |
| `source` | text NOT NULL DEFAULT 'manual' | `seed`, `approved_candidate`, `manual` |
| `source_file` | text | Original file path (for seed entries) |
| `created_at` | timestamptz DEFAULT NOW() | |
| `updated_at` | timestamptz DEFAULT NOW() | |

**Indexes:** `idx_kb_scope ON (scope)`, `idx_kb_tags USING gin(tags)`, `idx_kb_embedding USING ivfflat(embedding vector_cosine_ops)`

### `knowledge_graph.sessions`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | |
| `title` | text NOT NULL | Topic description |
| `scope` | text NOT NULL DEFAULT 'global' | Session context — queries auto-filter to this scope + global |
| `user_name` | text | Who started it |
| `status` | text NOT NULL DEFAULT 'active' | `active`, `closed` |
| `created_at` | timestamptz DEFAULT NOW() | |
| `updated_at` | timestamptz DEFAULT NOW() | Last activity |

### `knowledge_graph.session_entries`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | |
| `session_id` | integer NOT NULL FK -> sessions | Which session |
| `sequence` | integer NOT NULL | Order within session (1, 2, 3...) |
| `entry_type` | text NOT NULL | `question`, `observation`, `code`, `reference`, `note` |
| `content` | text NOT NULL | The context entry content |
| `metadata` | jsonb DEFAULT '{}' | Structured metadata (file paths, URLs, etc.) |
| `embedding` | vector(768) | For semantic search across entries |
| `created_at` | timestamptz DEFAULT NOW() | |

**Constraint:** `UNIQUE(session_id, sequence)`

### `knowledge_graph.knowledge_candidates`

| Column | Type | Purpose |
|--------|------|---------|
| `id` | serial PK | |
| `category` | text NOT NULL | Proposed category |
| `key` | text NOT NULL | Proposed key |
| `content` | text NOT NULL | The proposed rule/pattern |
| `embedding` | vector(768) | For duplicate detection |
| `rationale` | text | Why this should be a rule |
| `scope` | text NOT NULL DEFAULT 'global' | Proposed scope |
| `tags` | text[] DEFAULT '{}' | Proposed tags |
| `session_id` | integer FK -> sessions | The session that triggered discovery |
| `status` | text NOT NULL DEFAULT 'pending' | `pending`, `approved`, `rejected` |
| `reviewed_by` | text | Who approved/rejected |
| `reviewed_at` | timestamptz | |
| `created_at` | timestamptz DEFAULT NOW() | |

---

## Exploration Session Flow

```
User asks Claude to review a topic
    │
    ▼
knowledge_graph.start_session
    → creates session with scope, returns session_id
    │
    ▼
Multi-turn conversation
    │
    ├── knowledge_graph.add_context (entry_type: 'question')
    │     "Review the dbt framework in our codebase"
    │
    ├── knowledge_graph.add_context (entry_type: 'code')
    │     "Here's the relevant model code..."
    │
    ├── knowledge_graph.get_knowledge
    │     → retrieves existing knowledge for context
    │
    ├── knowledge_graph.add_context (entry_type: 'observation')
    │     "The incremental strategy uses merge keys incorrectly"
    │
    └── ... more back-and-forth ...
    │
    ▼
Distill into knowledge
    │
    ├── knowledge_graph.propose_knowledge
    │     → "dbt incremental models should use unique_key, not merge_key"
    │
    └── knowledge_graph.propose_knowledge
          → "dbt source freshness checks run on schedule X"
```

Sessions are multi-turn scratchpads. Context entries accumulate as the user and Claude explore a topic together. When insights emerge, they get distilled into `propose_knowledge` calls — each becoming a standalone knowledge base candidate.

---

## Scope & Tags

Every knowledge entry has a **scope** that determines its visibility:

```
scope=global                  → General best practices, patterns, definitions
scope=client:bgc              → BGC-specific: CMP schema, business rules, query patterns
scope=client:acme             → Acme-specific: legacy Oracle procedures, custom workflows
scope=personal                → Personal notes, blog ideas, cross-client observations
```

Sessions also have a default scope. `get_knowledge` automatically includes both the session's scope and `global` entries — so client-specific knowledge never leaks.

**Cross-scope discovery via tags:** Tags cut across scope boundaries. Filter by tags like `["legacy-systems"]` to surface insights from any scope about that theme.

```
tags=["legacy-systems"]       → Surfaces across all scopes when explicitly queried
tags=["ai-migration"]         → Cross-cutting AI modernization insights
tags=["tech-debt"]            → Technical debt patterns and solutions
tags=["best-practice"]        → Validated general practices
```

---

## Knowledge Lifecycle

1. **Seed** — Deploy-time population from markdown files via seeding script
2. **Query** — Embed question, retrieve relevant entries scoped to session context
3. **Explore** — Multi-turn sessions accumulate context entries
4. **Propose** — Distill session insights into knowledge candidates
5. **Review** — Approve/reject candidates; approved entries join the knowledge base
6. **Grow** — Knowledge base improves organically from real usage

---

## Security

- **Auth**: Bearer token via AuthMiddleware (from mcp-shared)
- **Schema isolation**: All tables in `knowledge_graph.*` schema
- **Embedding API**: Vertex AI via Application Default Credentials (no API key)

---

## Cloud Run

- Memory: 512 MB, Timeout: 60s, Concurrency: 1, Min: 0, Max: 1

---

## Client Configuration

```json
{
  "mcpServers": {
    "knowledge-graph": {
      "url": "https://knowledge-graph-mcp-xxxxxxxx.run.app/sse",
      "headers": {
        "Authorization": "Bearer <your-api-key>"
      }
    }
  }
}
```

---

## Future Considerations (Not in v1)

- Additional embedding providers (OpenAI, Voyage AI, local models)
- Web dashboard for browsing knowledge and reviewing candidates
- Knowledge deduplication via semantic similarity detection
- Scheduled re-seeding to pick up documentation changes
- Multi-user auth with per-user API keys
