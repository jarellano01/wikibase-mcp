#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  createEntry,
  getEntryById,
  listEntries,
  searchEntries,
  updateEntry,
  deleteEntry,
} from "@ai-wiki/db";
import { generateEmbedding } from "@ai-wiki/db/embeddings";

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

server.tool(
  "wiki_add",
  "Add a new entry to the AI wiki",
  {
    title: z.string().describe("Entry title"),
    content: z.string().describe("Full content"),
    type: z.enum(["note", "idea", "article", "thought"]).default("note"),
    summary: z.string().optional().describe("Brief summary for token-efficient retrieval"),
    tags: z.array(z.string()).optional().describe("Tags for categorization"),
  },
  async ({ title, content, type, summary, tags }) => {
    const warnings = scanForSensitiveData([title, summary ?? "", content].join(" "));
    const embedding = await generateEmbedding(`${title} ${summary ?? ""} ${content}`);
    const entry = await createEntry({ title, content, type, summary, tags: tags ?? [], embedding });
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
    type: z.enum(["note", "idea", "article", "thought"]).optional(),
    summary: z.string().optional().describe("New summary"),
    tags: z.array(z.string()).optional(),
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

const transport = new StdioServerTransport();
await server.connect(transport);
