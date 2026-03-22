# wikibase-mcp

A personal knowledge base designed around AI sessions — store thoughts, decisions, and articles in a Postgres database and access them from Claude Desktop mid-conversation via MCP.

## What It Does

Most useful thinking that happens inside AI sessions disappears when the tab closes. wikibase-mcp keeps it. Entries are embedded on save, so search works semantically — you find things by meaning, not keyword. The MCP server means Claude can read from and write to your knowledge base without leaving the conversation.

## Architecture

```
apps/cli     → Human CLI (wiki add, wiki search, wiki get...)
apps/mcp     → MCP stdio server (Claude uses this in sessions)
apps/server  → Read-only web dashboard (wiki serve)
apps/web     → Next.js frontend
packages/db  → Drizzle schema, migrations, shared queries
```

All apps share `packages/db` and hit the same Postgres database.

## Setup

**Prerequisites:** Node.js 20+, PostgreSQL (or [Neon](https://neon.tech) for a free hosted option), pnpm

```bash
pnpm install
cp .env.example .env
# Fill in DATABASE_URL in .env

pnpm db:migrate
pnpm dev
```

## CLI

```bash
wiki instance add      # configure a database instance (first-time setup)
wiki instance use      # switch active instance
wiki instance list     # list all instances
wiki mcp install       # register MCP server in Claude Desktop
wiki add               # add a new entry (interactive)
wiki list              # list recent entries
wiki search <query>    # full-text search
wiki get <id>          # get full entry by id or title
wiki delete <id>       # delete an entry
wiki serve             # start local web dashboard
```

## MCP Setup

```bash
wiki instance add   # configure your database
wiki mcp install    # writes the MCP config to Claude Desktop
```

Restart Claude Desktop. Claude can now use the wiki tools directly in any conversation.

Manual config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "ai-wiki": {
      "command": "wiki-mcp",
      "env": {
        "DATABASE_URL": "your-postgres-url"
      }
    }
  }
}
```

## MCP Tools

| Tool | Description |
|---|---|
| `wiki_add` | Add a new entry; auto-splits into blocks by `##` headings |
| `wiki_get` | Get an entry by ID or title |
| `wiki_search` | Semantic search across all entries |
| `wiki_list` | List recent entries |
| `wiki_update` | Update entry metadata |
| `wiki_delete` | Delete an entry |
| `wiki_split_blocks` | Split a single-block entry into per-heading blocks |
| `wiki_blocks_list` | List all blocks for an entry |
| `wiki_block_get` | Get a block with surrounding context |
| `wiki_block_add` | Add a new block to an entry |
| `wiki_block_update` | Rewrite a single block (auto-snapshots previous) |
| `wiki_block_rollback` | Roll back a block to a previous version |
| `wiki_block_reorder` | Reorder blocks within an entry |
| `wiki_block_delete` | Soft-delete a block |
| `wiki_block_metadata_update` | Update block type/metadata without changing content |
| `wiki_entry_comments` | List all unresolved review comments for an entry |
| `wiki_comment_resolve` | Mark a comment as resolved |
| `wiki_post_publish` | Publish or unpublish a post |
| `wiki_instance_list` | List configured database instances |
| `wiki_instance_use` | Switch active database instance |
| `wiki_migrate` | Run pending database migrations |

## Web Dashboard

```bash
wiki serve
```

- `/` — published posts only
- `/dash` — all entries with type/tag filters, review comments, management tools

## Database

Schema changes go through Drizzle Kit only. Never run DDL directly.

```bash
pnpm db:generate   # generate migration after editing packages/db/src/schema.ts
pnpm db:migrate    # apply pending migrations
pnpm db:studio     # open Drizzle Studio
```

## Stack

- **Runtime:** Node.js 20+ / TypeScript
- **ORM:** Drizzle ORM + Drizzle Kit
- **Database:** PostgreSQL + pgvector
- **Embeddings:** all-MiniLM-L6-v2 (local, via HuggingFace Transformers)
- **CLI:** Commander.js
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Web:** Next.js 15
- **Package manager:** pnpm
- **Monorepo:** Turborepo
