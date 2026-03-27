import { Command } from "commander";

const INSTRUCTIONS = `
# Wikibase CLI — AI Instructions

A personal knowledge base for storing notes, ideas, articles, and research across AI sessions and machines. Everything is stored in PostgreSQL and accessed via the \`wiki\` CLI.

## Data model

### Entry
The top-level unit. Has:
- \`id\` (UUID), \`title\`, \`type\` (note | idea | article | thought | post), \`status\` (draft | review | published)
- \`summary\` — token-efficient version of the content. Always populate when adding/updating.
- \`content\` — full markdown.
- \`tags\` — array of strings.

### Block
Entries are composed of ordered blocks. Every entry has at least one text block mirroring \`content\`. Blocks are the rendering source of truth in the web dashboard. Block edits are auto-snapshotted for rollback.

## CLI commands

\`\`\`
wiki search <query>        # semantic + full-text search — returns id, title, type, summary
wiki get <id|title>        # fetch full entry content by UUID or title
wiki list [--limit N]      # list recent entries (summaries only)
wiki add                   # interactive prompt to create a new entry
wiki update <id>           # interactive prompt to update an entry
wiki delete <id>           # delete an entry
wiki instance list         # show configured DB instances and which is active
wiki instance use <name>   # switch active instance
wiki instance add          # add a new DB instance (interactive)
\`\`\`

## Workflow guidelines

### Reading
- Always \`wiki search <query>\` first — it returns summaries without loading full content.
- Use \`wiki get <id>\` only when you need the full content.
- Use \`wiki list\` when browsing recent entries without a specific query.

### Writing
- Use \`wiki add\` to create new entries. Always provide a concise summary.
- Structure content with \`## \` headings — the system splits these into blocks automatically.
- Use \`wiki update <id>\` to modify existing entries.

### Instances
- Multiple DB instances can be configured (e.g. local, remote).
- Run \`wiki instance list\` to see what's available and which is active.
- Run \`wiki instance use <name>\` to switch.

## Sensitivity
- Never store credentials, API keys, private keys, or connection strings as entry content.
`.trim();

export const aiHowToCommand = new Command("ai-how-to")
  .description("Print instructions for AI assistants on how to use the wiki CLI")
  .action(() => {
    console.log(INSTRUCTIONS);
  });
