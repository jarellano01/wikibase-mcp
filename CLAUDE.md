# wikibase-mcp

A personal AI knowledge base — store thoughts, ideas, and articles accessible across machines and AI sessions.

## Architecture

```
apps/cli     → Human CLI (wiki add, wiki search, wiki get...)
apps/mcp     → Local MCP stdio server (Claude uses this in sessions)
apps/server  → Hono web dashboard (wiki serve) — SSR, blog + review UI
packages/db  → Drizzle schema, migrations, shared queries
```

All apps share `packages/db` and hit the same Postgres database.

## Database Rules — READ THIS FIRST

**NEVER manually modify the database schema or data outside of migrations.**

All schema changes MUST go through Drizzle Kit:

```bash
# After editing packages/db/src/schema.ts:
pnpm --filter @wikibase/db generate   # generates migration file
pnpm --filter @wikibase/db migrate    # applies migration to DB
```

Or from the repo root:
```bash
pnpm db:generate
pnpm db:migrate
```

Manually running `ALTER TABLE`, `CREATE TABLE`, or any DDL directly against the database is strictly prohibited. Migrations are the source of truth.

## Dev Setup

```bash
pnpm install
cp .env.example .env
# Fill in DATABASE_URL in .env

pnpm db:migrate        # run migrations
pnpm dev               # start all apps in parallel
```

## CLI Usage

```bash
wiki instance add      # add a database instance (first-time setup)
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

Run `wiki instance add` to configure a database, then `wiki mcp install` to register the MCP server in Claude Desktop. Restart Claude Desktop to activate.

Manual config if needed (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "wikibase": {
      "command": "wiki-mcp",
      "env": {
        "DATABASE_URL": "your-postgres-url"
      }
    }
  }
}
```

## Package Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Build all apps |
| `pnpm db:generate` | Generate Drizzle migration |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:studio` | Open Drizzle Studio |

## Stack

- **Runtime**: Node.js 20+
- **Language**: TypeScript
- **ORM**: Drizzle ORM + Drizzle Kit
- **Database**: PostgreSQL (full-text search via tsvector)
- **CLI**: Commander.js
- **MCP**: @modelcontextprotocol/sdk (stdio transport)
- **Web**: Hono + Node.js (SSR, HTMX for comments)
- **Package manager**: pnpm (always use pnpm, never npm or yarn)
- **Monorepo**: Turborepo
