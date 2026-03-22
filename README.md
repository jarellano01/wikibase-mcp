# wikibase-mcp

A personal knowledge base designed around AI sessions — store thoughts, decisions, and articles in a Postgres database and access them from Claude Desktop mid-conversation via MCP.

## What It Does

Most useful thinking that happens inside AI sessions disappears when the tab closes. wikibase-mcp keeps it. Entries are embedded on save, so search works semantically — you find things by meaning, not keyword. The MCP server means Claude can read from and write to your knowledge base without leaving the conversation.

## Architecture

```
apps/cli     → Human CLI (wiki add, wiki search, wiki get...)
apps/mcp     → MCP stdio server (Claude uses this in sessions)
apps/server  → Hono web server (wiki serve / personal blog)
packages/db  → Drizzle schema, migrations, shared queries
```

All apps share `packages/db` and hit the same Postgres database.

## Installation

**Prerequisites:** Node.js 20+, PostgreSQL (or [Neon](https://neon.tech) for a free hosted option), pnpm

### Clone and build (current method)

```bash
git clone https://github.com/jarellano01/wikibase-mcp.git
cd wikibase-mcp
pnpm install
pnpm build
```

Then link the CLI globally:

```bash
npm link --global ./apps/cli
```

> **Why not `npm install -g github:jarellano01/wikibase-mcp`?**
> This is a monorepo with workspace dependencies — the CLI depends on `@ai-wiki/db` via `workspace:*`, which doesn't resolve when installing from a GitHub URL. npm publishing is planned; once `@ai-wiki/cli` is on the registry you'll be able to run `npm install -g @ai-wiki/cli`.

### After installation

```bash
cp .env.example .env
# Fill in DATABASE_URL in .env

pnpm db:migrate
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

## Deploying as a Personal Blog (Cloud Run + Cloudflare Tunnel)

The web server (`apps/server`) is published to Docker Hub on every push to `main` as `jarellano01/ai-wiki-serve:<sha>`. You can deploy it to Cloud Run and route custom subdomains to it via a Cloudflare Tunnel — no GCP load balancer required (~$3-4/mo vs ~$18/mo).

### 1. Deploy to Cloud Run

```bash
gcloud run deploy ai-wiki-serve \
  --image docker.io/jarellano01/ai-wiki-serve:<sha> \
  --region us-central1 \
  --platform managed \
  --ingress all \
  --set-env-vars DATABASE_URL=<your-neon-or-postgres-url> \
  --port 3001 \
  --min-instances 0 \
  --max-instances 2
```

Use `--ingress all` — Cloudflare Tunnel routes traffic via Cloudflare's external network, not GCP's internal network, so `--ingress internal` won't work.

### 2. Set Up Cloudflare Tunnel

Install `cloudflared` and authenticate:

```bash
brew install cloudflared
cloudflared tunnel login        # opens browser, saves cert to ~/.cloudflared/
cloudflared tunnel create wiki  # creates tunnel, saves credentials JSON
```

Deploy `cloudflared` as a second Cloud Run service using the official image. It needs two secrets:
- The credentials JSON from the tunnel creation step
- A config YAML pointing it at your Cloud Run service URL

```yaml
# config.yaml
tunnel: <tunnel-id>
credentials-file: /etc/cf-creds/credentials.json

ingress:
  - hostname: blog.yourdomain.com
    service: https://<your-cloud-run-url>
    originRequest:
      httpHostHeader: <your-cloud-run-url>  # required — Cloud Run checks the Host header
  - service: http_status:404
```

> **Note:** The `httpHostHeader` override is required. Cloud Run validates the `Host` header and returns 404 if it doesn't match a known domain mapping.

Mount the secrets in separate directories (Cloud Run doesn't allow two secrets in the same mount path):

```bash
gcloud run deploy cloudflared \
  --image cloudflare/cloudflared:latest \
  --args="tunnel,--config,/etc/cf-config/config.yaml,run,--protocol,http2" \
  --set-secrets="/etc/cf-config/config.yaml=cf-tunnel-config:latest" \
  --set-secrets="/etc/cf-creds/credentials.json=cf-tunnel-creds:latest" \
  --min-instances 1 \   # must stay alive to hold the tunnel
  --port 8080 \         # cloudflared --metrics binds here for the health probe
  --ingress all
```

Use `--protocol http2` — Cloud Run blocks UDP, which is what QUIC uses.

### 3. DNS

In Cloudflare, add a CNAME for each subdomain pointing to `<tunnel-id>.cfargotunnel.com` with proxying enabled. That's it — SSL is handled automatically.

To add a new service, add one more `ingress` rule to the config and one more CNAME. No infra changes.

---

For a full walkthrough see the [Cloudflare Tunnels as a Free Load Balancer](https://worksmart.dev) post.

## Stack

- **Runtime:** Node.js 20+ / TypeScript
- **ORM:** Drizzle ORM + Drizzle Kit
- **Database:** PostgreSQL + pgvector
- **Embeddings:** all-MiniLM-L6-v2 (local, via HuggingFace Transformers)
- **CLI:** Commander.js
- **MCP:** @modelcontextprotocol/sdk (stdio transport)
- **Web:** Hono + marked (server-rendered HTML)
- **Package manager:** pnpm
- **Monorepo:** Turborepo
