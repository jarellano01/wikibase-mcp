#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import {
  createEntry,
  createEntryWithBlock,
  createEntryWithBlocks,
  getEntryById,
  listEntries,
  searchEntries,
  updateEntry,
  deleteEntry,
  readConfig,
  selectInstance,
} from "@ai-wiki/db";
import {
  createBlock,
  getBlocksByEntry,
  getBlockWithContext,
  updateBlock,
  updateBlockMetadata,
  softDeleteBlock,
  reorderBlocks,
  rollbackBlock,
  findDuplicateBlocks,
  assembleCanonical,
  updatePostMeta,
  addBlockComment,
  getUnresolvedCommentsByEntry,
  resolveComment,
} from "@ai-wiki/db/blocks";
import { generateEmbedding } from "@ai-wiki/db/embeddings";
import { watchFile } from "fs";
import { resetDb, CONFIG_PATH } from "@ai-wiki/db";

// Hot-swap the DB connection when the active instance changes
watchFile(CONFIG_PATH, { interval: 500 }, () => {
  resetDb();
});

interface SensitivityWarning {
  type: string;
  match: string;
}

function scanForSensitiveData(text: string): SensitivityWarning[] {
  const warnings: SensitivityWarning[] = [];
  const checks: Array<{ type: string; pattern: RegExp; redact?: boolean }> = [
    // Credentials & secrets
    { type: "API key / token", pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token)\s*[:=]\s*\S+/gi },
    { type: "Bearer token", pattern: /bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi },
    { type: "Private key block", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY/i },
    { type: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{36,}/g },
    { type: "Generic secret assignment", pattern: /(?:password|passwd|secret|token|credential)\s*[:=]\s*['"][^'"]{6,}['"]/gi },
    // Connection strings
    { type: "Database URL", pattern: /(?:postgresql|postgres|mysql|mongodb|redis|mssql):\/\/[^\s'"]+/gi },
    { type: "Connection string with credentials", pattern: /[a-zA-Z]+:\/\/[^:@\s]+:[^@\s]+@\S+/g },
    // Network
    { type: "Private IP address", pattern: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/g },
    { type: "IPv6 address", pattern: /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g },
    // AWS
    { type: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/g },
    { type: "AWS secret key", pattern: /aws[_-]?secret[_-]?(?:access[_-]?)?key\s*[:=]\s*\S+/gi },
    // Environment / config leaks
    { type: "Hardcoded .env value", pattern: /(?:^|\n)\s*[A-Z_]{3,}=(?!your-|<|{|\$)[^\s#]{8,}/gm },
    // PII
    { type: "Email address", pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g },
  ];

  for (const { type, pattern } of checks) {
    const matches = text.match(pattern);
    if (matches) {
      // Redact most of the match to avoid echoing secrets in the warning
      const sample = matches[0].length > 60 ? matches[0].slice(0, 30) + "…" : matches[0];
      warnings.push({ type, match: sample });
    }
  }

  return warnings;
}

function formatWarnings(warnings: SensitivityWarning[]): string {
  if (warnings.length === 0) return "";
  const lines = warnings.map((w) => `  ⚠ ${w.type}: "${w.match}"`).join("\n");
  return `\n\n⚠️ SENSITIVITY WARNING — possible sensitive data detected:\n${lines}\nReview before sharing or exporting this entry.`;
}

const server = new McpServer({
  name: "ai-wiki",
  version: "0.1.0",
});

// Accepts either a proper string array or a JSON-stringified array (e.g. from Claude Code tool calls)
const tagsSchema = z.union([
  z.array(z.string()),
  z.string().transform((s) => JSON.parse(s) as string[]),
]).optional();

server.tool(
  "wiki_add",
  "Add a new entry to the AI wiki",
  {
    title: z.string().describe("Entry title"),
    content: z.string().describe("Full content"),
    type: z.enum(["note", "idea", "article", "thought", "post"]).default("note"),
    summary: z.string().optional().describe("Brief summary for token-efficient retrieval"),
    tags: tagsSchema.describe("Tags for categorization"),
  },
  async ({ title, content, type, summary, tags }) => {
    const warnings = scanForSensitiveData([title, summary ?? "", content].join(" "));
    const embedding = await generateEmbedding(`${title} ${summary ?? ""} ${content}`);

    // Split content into blocks by ## headings
    const sections = content.split(/(?=\n## )/);
    const blockContents = sections
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    let entry;
    if (blockContents.length > 1) {
      const blockEmbeddings = await Promise.all(
        blockContents.map((s) => generateEmbedding(s))
      );
      entry = await createEntryWithBlocks(
        { title, content, type, summary, tags: tags ?? [], embedding },
        blockContents.map((c, i) => ({ content: c, embedding: blockEmbeddings[i] }))
      );
    } else {
      entry = await createEntryWithBlock(
        { title, content, type, summary, tags: tags ?? [], embedding },
        content,
        embedding
      );
    }

    return {
      content: [{ type: "text", text: `Added entry: [${entry.id}] ${entry.title}${formatWarnings(warnings)}` }],
    };
  }
);

server.tool(
  "wiki_search",
  "Search the AI wiki by semantic similarity",
  { query: z.string().describe("Search query") },
  async ({ query }) => {
    const queryEmbedding = await generateEmbedding(query);
    const results = await searchEntries(query, queryEmbedding);
    if (results.length === 0) {
      return { content: [{ type: "text", text: "No results found." }] };
    }
    const text = results
      .map((e) => `[${e.id}] ${e.title} (${e.type})\n${e.summary ?? e.content.slice(0, 200)}...`)
      .join("\n\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "wiki_get",
  "Get a full entry by ID",
  { id: z.string().uuid().describe("Entry UUID") },
  async ({ id }) => {
    const entry = await getEntryById(id);
    if (!entry) return { content: [{ type: "text", text: `No entry found: ${id}` }] };
    const text = `# ${entry.title}\nType: ${entry.type} | Tags: ${entry.tags.join(", ") || "none"}\n\n${entry.content}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "wiki_list",
  "List recent wiki entries (returns summaries, not full content)",
  { limit: z.number().int().min(1).max(50).default(10) },
  async ({ limit }) => {
    const results = await listEntries(limit);
    if (results.length === 0) {
      return { content: [{ type: "text", text: "No entries yet." }] };
    }
    const text = results
      .map((e) => `[${e.id}] ${e.title} (${e.type}) — ${e.summary ?? "no summary"}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "wiki_update",
  "Update an existing wiki entry by ID. Only provided fields are changed; omitted fields stay as-is. Regenerates the embedding when content changes.",
  {
    id: z.string().uuid().describe("Entry UUID"),
    title: z.string().optional().describe("New title"),
    content: z.string().optional().describe("New full content"),
    type: z.enum(["note", "idea", "article", "thought", "post"]).optional(),
    summary: z.string().optional().describe("New summary"),
    tags: tagsSchema,
  },
  async ({ id, title, content, type, summary, tags }) => {
    const existing = await getEntryById(id);
    if (!existing) return { content: [{ type: "text", text: `No entry found: ${id}` }] };

    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (content !== undefined) patch.content = content;
    if (type !== undefined) patch.type = type;
    if (summary !== undefined) patch.summary = summary;
    if (tags !== undefined) patch.tags = tags;

    if (title !== undefined || content !== undefined || summary !== undefined) {
      const t = title ?? existing.title;
      const s = summary ?? existing.summary ?? "";
      const c = content ?? existing.content;
      patch.embedding = await generateEmbedding(`${t} ${s} ${c}`);
    }

    const updated = await updateEntry(id, patch);

    if (content !== undefined) {
      const existingBlocks = await getBlocksByEntry(id);
      const textBlock = existingBlocks.find((b) => b.type === "text");
      if (textBlock) await updateBlock(textBlock.id, content, "human");
    }

    const changedText = [title, summary, content].filter(Boolean).join(" ");
    const warnings = changedText ? scanForSensitiveData(changedText) : [];
    return {
      content: [{ type: "text", text: `Updated: [${updated!.id}] ${updated!.title}${formatWarnings(warnings)}` }],
    };
  }
);

server.tool(
  "wiki_delete",
  "Delete an entry by ID",
  { id: z.string().uuid() },
  async ({ id }) => {
    const deleted = await deleteEntry(id);
    return {
      content: [{ type: "text", text: deleted ? `Deleted ${id}` : `Entry not found: ${id}` }],
    };
  }
);

server.tool(
  "wiki_block_add",
  "Insert a new block into a post at a specific position. Shifts all existing blocks at or after that position down by one. Generates an embedding for the content.",
  {
    entryId: z.string().uuid().describe("Post entry UUID"),
    type: z.enum(["heading", "paragraph", "image", "code", "quote", "divider", "list", "html"]),
    content: z.string().describe("Markdown content for the block, or raw HTML if type is 'html'"),
    position: z.coerce.number().int().describe("Position to insert at (0-indexed). Existing blocks at this position and after are shifted down."),
    metadata: z.record(z.unknown()).optional().describe("Type-specific metadata (e.g. { level: 2 } for headings)"),
  },
  async ({ entryId, type, content, position, metadata }) => {
    const existing = await getBlocksByEntry(entryId);
    // Create at a temporary position beyond the end
    const block = await createBlock({
      entryId, type, content,
      position: existing.length,
      metadata,
      generateEmbeddingForContent: true,
    });
    // Build desired order with new block inserted at target position
    const ids = existing.map((b) => b.id);
    const clampedPos = Math.min(position, existing.length);
    ids.splice(clampedPos, 0, block.id);
    await reorderBlocks(entryId, ids);
    return { content: [{ type: "text", text: `Inserted block ${block.id} at position ${clampedPos}` }] };
  }
);

server.tool(
  "wiki_blocks_list",
  "List all blocks for a post entry. Returns a lightweight outline (id, type, position, content preview). Use before AI edits or restructuring.",
  { entryId: z.string().uuid().describe("Post entry UUID") },
  async ({ entryId }) => {
    const blockList = await getBlocksByEntry(entryId);
    if (blockList.length === 0) {
      return { content: [{ type: "text", text: "No blocks found for this entry." }] };
    }
    const text = blockList
      .map((b) => `[${b.id}] pos:${b.position} type:${b.type}\n  ${b.content.slice(0, 120)}`)
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "wiki_block_get",
  "Get a block by ID with one block of surrounding context (prev + next). Use this before making an AI edit to a block.",
  { id: z.string().uuid().describe("Block UUID") },
  async ({ id }) => {
    const { prev, target, next } = await getBlockWithContext(id);
    if (!target) return { content: [{ type: "text", text: `Block not found: ${id}` }] };
    const parts = [
      prev ? `[PREV pos:${prev.position}]\n${prev.content}` : "[PREV] (none)",
      `[TARGET pos:${target.position} type:${target.type}]\n${target.content}`,
      next ? `[NEXT pos:${next.position}]\n${next.content}` : "[NEXT] (none)",
    ];
    return { content: [{ type: "text", text: parts.join("\n\n---\n\n") }] };
  }
);

server.tool(
  "wiki_block_update",
  "Update the content of a single block. Automatically snapshots the previous content to block_revisions before applying the change. Regenerates the block embedding.",
  {
    id: z.string().uuid().describe("Block UUID"),
    content: z.string().describe("New markdown content for this block"),
    source: z.enum(["human", "ai-rewrite", "ai-suggest"]).default("ai-rewrite"),
    note: z.string().optional().describe("Optional note (e.g. the instruction or prompt used)"),
  },
  async ({ id, content, source, note }) => {
    const updated = await updateBlock(id, content, source, note);
    if (!updated) return { content: [{ type: "text", text: `Block not found: ${id}` }] };
    return { content: [{ type: "text", text: `Updated block ${id} (pos:${updated.position})` }] };
  }
);

server.tool(
  "wiki_block_metadata_update",
  "Update the metadata of a block (e.g. src/alt/caption for image blocks, level for headings). Does not affect content or embedding.",
  {
    id: z.string().uuid().describe("Block UUID"),
    metadata: z.record(z.unknown()).describe("Full metadata object to set on the block"),
  },
  async ({ id, metadata }) => {
    const updated = await updateBlockMetadata(id, metadata);
    if (!updated) return { content: [{ type: "text", text: `Block not found: ${id}` }] };
    return { content: [{ type: "text", text: `Updated metadata for block ${id}` }] };
  }
);

server.tool(
  "wiki_block_reorder",
  "Reorder blocks within a post. Provide the ordered list of block IDs that should remain active. Blocks not in the list are soft-deleted. Snapshots all positions to block_revisions before applying.",
  {
    entryId: z.string().uuid().describe("Post entry UUID"),
    orderedIds: z
      .array(z.string().uuid())
      .describe("Block IDs in the desired order. Only these blocks will remain active."),
  },
  async ({ entryId, orderedIds }) => {
    // Soft-delete blocks not in the new order
    const existing = await getBlocksByEntry(entryId);
    const keepSet = new Set(orderedIds);
    for (const block of existing) {
      if (!keepSet.has(block.id)) {
        await softDeleteBlock(block.id);
      }
    }
    await reorderBlocks(entryId, orderedIds);
    return {
      content: [{ type: "text", text: `Reordered ${orderedIds.length} blocks for entry ${entryId}` }],
    };
  }
);

server.tool(
  "wiki_block_delete",
  "Soft-delete a block by ID. The block is hidden from the entry but preserved in the database for recovery.",
  { id: z.string().uuid().describe("Block UUID") },
  async ({ id }) => {
    const deleted = await softDeleteBlock(id);
    return {
      content: [{ type: "text", text: deleted ? `Deleted block ${id}` : `Block not found: ${id}` }],
    };
  }
);

server.tool(
  "wiki_block_rollback",
  "Roll back a block to its last human-authored revision, undoing AI edits.",
  { id: z.string().uuid().describe("Block UUID") },
  async ({ id }) => {
    const restored = await rollbackBlock(id);
    if (!restored)
      return { content: [{ type: "text", text: `No human revision found for block ${id}` }] };
    return { content: [{ type: "text", text: `Rolled back block ${id} to last human revision` }] };
  }
);

server.tool(
  "wiki_post_publish",
  "Publish a post: assembles all active blocks into canonical markdown, saves it to the entry metadata, and sets status to published.",
  { entryId: z.string().uuid().describe("Post entry UUID") },
  async ({ entryId }) => {
    const canonical = await assembleCanonical(entryId);
    await updatePostMeta(entryId, {
      status: "published",
      publishedAt: new Date().toISOString(),
    });
    return {
      content: [
        {
          type: "text",
          text: `Published entry ${entryId}. Canonical: ${canonical.length} chars across assembled blocks.`,
        },
      ],
    };
  }
);

server.tool(
  "wiki_entry_comments",
  "List all unresolved review comments for an entry, grouped by block. Use this to see what needs to be addressed before publishing.",
  { entryId: z.string().uuid().describe("Entry UUID") },
  async ({ entryId }) => {
    const comments = await getUnresolvedCommentsByEntry(entryId);
    if (comments.length === 0) {
      return { content: [{ type: "text", text: "No unresolved comments." }] };
    }
    const text = comments
      .map((c) => `[${c.id}] Block ${c.blockId} (pos:${c.blockPosition} type:${c.blockType})\n  ${c.body}`)
      .join("\n\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "wiki_comment_resolve",
  "Mark a comment as resolved after addressing it.",
  { id: z.string().uuid().describe("Comment UUID") },
  async ({ id }) => {
    const resolved = await resolveComment(id);
    if (!resolved) return { content: [{ type: "text", text: `Comment not found: ${id}` }] };
    return { content: [{ type: "text", text: `Resolved comment ${id}` }] };
  }
);

server.tool(
  "wiki_instance_list",
  "List all configured database instances and show which one is active.",
  {},
  async () => {
    const config = readConfig();
    if (!config || config.instances.length === 0) {
      return { content: [{ type: "text", text: "No instances configured. Run `wiki setup` to get started." }] };
    }
    const text = config.instances
      .map((inst) => {
        const active = inst.name === config.selectedInstance;
        let display = inst.databaseUrl;
        try {
          const u = new URL(inst.databaseUrl);
          display = `${u.protocol}//${u.username}@${u.hostname}${u.pathname}`;
        } catch { /* leave as-is */ }
        return `${active ? "▶" : " "} ${inst.name}${active ? " (active)" : ""} — ${display}`;
      })
      .join("\n");
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "wiki_instance_use",
  "Switch the active database instance by name.",
  { name: z.string().describe("Instance name to switch to") },
  async ({ name }) => {
    try {
      selectInstance(name);
      resetDb();
      return { content: [{ type: "text", text: `Switched to instance "${name}".` }] };
    } catch (err) {
      return { content: [{ type: "text", text: (err as Error).message }] };
    }
  }
);

server.tool(
  "wiki_migrate",
  "Run pending database migrations against the active instance. Use this to fix migration-related errors.",
  {},
  async () => {
    try {
      const db = getDb();
      // apps/mcp/dist/index.js → ../../cli/migrations
      const migrationsFolder = join(dirname(fileURLToPath(import.meta.url)), "../../cli/migrations");
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
      await migrate(db, { migrationsFolder });
      return { content: [{ type: "text", text: "Migrations applied successfully." }] };
    } catch (err) {
      return { content: [{ type: "text", text: `Migration failed: ${(err as Error).message}` }] };
    }
  }
);

server.resource(
  "instructions",
  "wiki://instructions",
  { mimeType: "text/markdown" },
  async () => ({
    contents: [{
      uri: "wiki://instructions",
      mimeType: "text/markdown",
      text: `# AI Wiki — MCP Instructions

## What is this?
A personal knowledge base for storing notes, ideas, articles, and research across AI sessions and machines. Everything is stored in PostgreSQL and accessible via this MCP server.

## Data model

### Entry
The top-level unit. Has:
- \`title\`, \`type\` (note | idea | article | thought | post), \`summary\`, \`tags\`, \`content\`
- \`summary\` is the token-efficient version — always populate it. Use it in search results and lists.
- \`content\` is the full markdown. Always kept in sync with the entry's text blocks.

### Block
Entries are composed of ordered blocks. Every entry has at least one \`text\` block mirroring \`content\`. Additional block types: \`heading\`, \`paragraph\`, \`image\`, \`code\`, \`quote\`, \`list\`, \`html\`.
- Blocks are the rendering source of truth in the web dashboard.
- \`html\` blocks render raw HTML — useful for layouts (e.g. side-by-side images).
- Image blocks store the URL in \`metadata.src\` (not \`content\`).
- Block edits are auto-snapshotted to \`block_revisions\` for rollback.

## Workflow guidelines

### Reading
- Use \`wiki_search\` for semantic lookup before \`wiki_list\`.
- Use \`wiki_get\` only when you need the full content — \`wiki_list\` returns summaries.
- Use \`wiki_blocks_list\` to get a block outline before editing structured entries.

### Writing
- \`wiki_add\` creates the entry AND splits content into multiple \`text\` blocks by \`## \` headings automatically. Always provide a \`summary\`. Structure content with \`## \` headings to get meaningful block granularity.
- \`wiki_update\` syncs the \`text\` block automatically when \`content\` changes.
- For block-level edits: \`wiki_block_get\` → \`wiki_block_update\`. Never skip the get step.
- Use \`wiki_block_add\` with type \`html\` for rich layouts.
- Use \`wiki_block_metadata_update\` to set image \`src\`/\`alt\`/\`caption\` — never put image URLs in \`content\`.

### Instances
- Multiple DB instances can be configured (e.g. local, neon-aiwiki).
- Use \`wiki_instance_list\` to see what's available and which is active.
- Use \`wiki_instance_use\` to switch.
- If you hit DB errors, try \`wiki_migrate\` first — it applies any pending migrations.

### Review comments

Comments are left by the human via the web UI on individual blocks — treat them like inline code review notes. The workflow below is the expected interaction pattern whenever you are asked to address, review, or work through comments.

#### Comment review workflow

1. **Fetch comments** — call \`wiki_entry_comments\` with the entry ID.
2. **Group by block** — if multiple comments land on the same block, handle them together in one review moment, not separately.
3. **For each block (or group of comments on the same block):**
   a. Call \`wiki_block_get\` to retrieve the target block plus one block of surrounding context (prev + next).
   b. **Acknowledge** — briefly restate what the comment is asking for so the human can confirm you understood it correctly.
   c. **Show context** — quote the relevant portion of the block content so the human can see exactly what section is being discussed.
   d. **Propose or ask** — either:
      - Present a concrete proposed rewrite of the block and ask for approval before applying, OR
      - If the comment is ambiguous or requires a judgment call, ask a focused question first. Don't make assumptions on open-ended feedback.
   e. **Wait for confirmation** before calling \`wiki_block_update\`.
4. **After applying a change** — call \`wiki_comment_resolve\` for every comment that was addressed in that step. If a block had 3 comments and you addressed all 3, resolve all 3.
5. **Move to the next block** — don't batch all changes upfront. Address one block (or one group) at a time, confirm, apply, resolve, then continue.
6. **When all comments are done** — summarize what changed across the entry.

#### Tone
- Be direct. One sentence to acknowledge, one to show context, one to propose. Don't over-explain.
- If you're proposing a rewrite, show the full new block content — not a diff, not a description of what changed.
- If the comment says something is wrong but doesn't say how to fix it, propose the most obvious fix and ask if that's the intent.

### Sensitivity
- \`wiki_add\` and \`wiki_update\` automatically scan for secrets (API keys, DB URLs, tokens) and warn before saving.
- Never store credentials, private keys, or connection strings as entry content.
`,
    }],
  })
);

const transport = new StdioServerTransport();
await server.connect(transport);
