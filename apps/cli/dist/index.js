#!/usr/bin/env node

// src/index.ts
import { Command as Command15 } from "commander";

// src/commands/add.ts
import { Command } from "commander";
import { input, select, editor } from "@inquirer/prompts";
import { createEntryWithBlock } from "@wikibase/db";
import { generateEmbedding } from "@wikibase/db/embeddings";
var addCommand = new Command("add").description("Add a new entry to the wiki").action(async () => {
  const title = await input({ message: "Title:" });
  const type = await select({
    message: "Type:",
    choices: [
      { value: "note" },
      { value: "idea" },
      { value: "article" },
      { value: "thought" }
    ]
  });
  const content = await editor({ message: "Content (opens editor):" });
  const summary = await input({
    message: "Summary (optional, used for token-efficient AI retrieval):"
  });
  const tagsInput = await input({
    message: "Tags (comma-separated, optional):"
  });
  const tags = tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : [];
  process.stdout.write("Generating embedding...");
  const embedding = await generateEmbedding(`${title} ${summary || ""} ${content}`);
  process.stdout.write(" done\n");
  const entry = await createEntryWithBlock(
    { title, type, content, summary: summary || null, tags, embedding },
    content,
    embedding
  );
  console.log(`
Added: [${entry.id}] ${entry.title}`);
});

// src/commands/get.ts
import { Command as Command2 } from "commander";
import { getEntryById } from "@wikibase/db";
var getCommand = new Command2("get").description("Get a full entry by ID").argument("<id>", "Entry UUID").action(async (id) => {
  const entry = await getEntryById(id);
  if (!entry) {
    console.error(`No entry found with id: ${id}`);
    process.exit(1);
  }
  console.log(`# ${entry.title}`);
  console.log(`Type: ${entry.type} | Tags: ${entry.tags.join(", ") || "none"}`);
  console.log(`Created: ${entry.createdAt.toISOString()}
`);
  if (entry.summary) console.log(`**Summary:** ${entry.summary}
`);
  console.log(entry.content);
});

// src/commands/search.ts
import { Command as Command3 } from "commander";
import { searchEntries } from "@wikibase/db";
import { generateEmbedding as generateEmbedding2 } from "@wikibase/db/embeddings";
var searchCommand = new Command3("search").description("Search entries by semantic similarity or keyword").argument("<query>", "Search query").action(async (query) => {
  const queryEmbedding = await generateEmbedding2(query);
  const results = await searchEntries(query, queryEmbedding);
  if (results.length === 0) {
    console.log("No results found.");
    return;
  }
  for (const entry of results) {
    console.log(`[${entry.id}] ${entry.title} (${entry.type})`);
    if (entry.summary) console.log(`  ${entry.summary}`);
    console.log(`  Tags: ${entry.tags.join(", ") || "none"} | ${entry.createdAt.toISOString()}`);
    console.log();
  }
});

// src/commands/list.ts
import { Command as Command4 } from "commander";
import { listEntries } from "@wikibase/db";
var listCommand = new Command4("list").description("List recent entries").option("-l, --limit <n>", "Number of entries", "20").action(async (opts) => {
  const entries = await listEntries(parseInt(opts.limit));
  if (entries.length === 0) {
    console.log("No entries yet. Run `wiki add` to create one.");
    return;
  }
  for (const entry of entries) {
    console.log(`[${entry.id}] ${entry.title} (${entry.type})`);
    console.log(`  Tags: ${entry.tags.join(", ") || "none"} | ${entry.createdAt.toISOString()}`);
  }
});

// src/commands/delete.ts
import { Command as Command5 } from "commander";
import { confirm } from "@inquirer/prompts";
import { deleteEntry, getEntryById as getEntryById2 } from "@wikibase/db";
var deleteCommand = new Command5("delete").description("Delete an entry by ID").argument("<id>", "Entry UUID").action(async (id) => {
  const entry = await getEntryById2(id);
  if (!entry) {
    console.error(`No entry found with id: ${id}`);
    process.exit(1);
  }
  const confirmed = await confirm({
    message: `Delete "${entry.title}"?`,
    default: false
  });
  if (!confirmed) {
    console.log("Aborted.");
    return;
  }
  await deleteEntry(id);
  console.log(`Deleted: ${entry.title}`);
});

// src/commands/update.ts
import { Command as Command6 } from "commander";
import { input as input2, select as select2, editor as editor2 } from "@inquirer/prompts";
import { getEntryById as getEntryById3, updateEntry } from "@wikibase/db";
import { generateEmbedding as generateEmbedding3 } from "@wikibase/db/embeddings";
import { getBlocksByEntry, updateBlock } from "@wikibase/db/blocks";
var updateCommand = new Command6("update").description("Update an existing wiki entry").argument("<id>", "Entry UUID").action(async (id) => {
  const existing = await getEntryById3(id);
  if (!existing) {
    console.error(`No entry found: ${id}`);
    process.exit(1);
  }
  console.log(`Updating: [${existing.id}] ${existing.title}
`);
  const title = await input2({ message: "Title:", default: existing.title });
  const type = await select2({
    message: "Type:",
    choices: [{ value: "note" }, { value: "idea" }, { value: "article" }, { value: "thought" }],
    default: existing.type
  });
  const content = await editor2({ message: "Content (opens editor):", default: existing.content });
  const summary = await input2({
    message: "Summary:",
    default: existing.summary ?? ""
  });
  const tagsInput = await input2({
    message: "Tags (comma-separated):",
    default: existing.tags.join(", ")
  });
  const tags = tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const contentChanged = title !== existing.title || content !== existing.content || summary !== (existing.summary ?? "");
  let embedding = existing.embedding;
  if (contentChanged) {
    process.stdout.write("Regenerating embedding...");
    embedding = await generateEmbedding3(`${title} ${summary} ${content}`);
    process.stdout.write(" done\n");
  }
  const updated = await updateEntry(id, {
    title,
    type,
    content,
    summary: summary || null,
    tags,
    embedding
  });
  if (content !== existing.content) {
    const existingBlocks = await getBlocksByEntry(id);
    const textBlock = existingBlocks.find((b) => b.type === "text");
    if (textBlock) await updateBlock(textBlock.id, content, "human");
  }
  console.log(`
Updated: [${updated.id}] ${updated.title}`);
});

// src/commands/setup.ts
import { Command as Command7 } from "commander";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { readConfig } from "@wikibase/db";
var mcpCommand = new Command7("mcp").description("Manage the MCP server");
mcpCommand.command("install").description("Register the MCP server in Claude Desktop and/or Claude Code").option("--desktop", "Install for Claude Desktop only").option("--code", "Install for Claude Code only").action((opts) => {
  const config = readConfig();
  if (!config || config.instances.length === 0) {
    console.log("No instances configured. Run `wiki instance add` first to set up a database.");
    process.exit(1);
  }
  let command = "wiki-mcp";
  try {
    command = execFileSync("which", ["wiki-mcp"], { encoding: "utf-8" }).trim();
  } catch {
  }
  const installDesktop = opts.desktop || !opts.desktop && !opts.code;
  const installCode = opts.code || !opts.desktop && !opts.code;
  if (installDesktop) {
    const dir = join(homedir(), "Library", "Application Support", "Claude");
    const path = join(dir, "claude_desktop_config.json");
    let cfg = {};
    if (existsSync(path)) {
      cfg = JSON.parse(readFileSync(path, "utf-8"));
    } else {
      mkdirSync(dir, { recursive: true });
    }
    const servers = cfg.mcpServers ?? {};
    servers["wikibase"] = { command };
    cfg.mcpServers = servers;
    writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`Claude Desktop: registered in ${path}`);
  }
  if (installCode) {
    const path = join(homedir(), ".claude.json");
    let cfg = {};
    if (existsSync(path)) {
      cfg = JSON.parse(readFileSync(path, "utf-8"));
    }
    const servers = cfg.mcpServers ?? {};
    servers["wikibase"] = { type: "stdio", command, args: [], env: {} };
    cfg.mcpServers = servers;
    writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
    console.log(`Claude Code:    registered in ${path}`);
  }
  console.log("\nRestart Claude Desktop / reload Claude Code to activate.");
});

// src/commands/serve.ts
import { Command as Command8 } from "commander";
import { spawn } from "child_process";
import { join as join2 } from "path";
var serveCommand = new Command8("serve").description("Start the local web dashboard").option("-p, --port <port>", "Port", "3001").action((opts) => {
  const serverEntry = join2(import.meta.dirname, "../../server/dist/index.js");
  console.log(`Starting web dashboard on http://localhost:${opts.port}`);
  const proc = spawn("node", [serverEntry], {
    stdio: "inherit",
    env: { ...process.env, PORT: opts.port }
  });
  proc.on("error", (err) => {
    console.error("Failed to start web dashboard:", err.message);
    process.exit(1);
  });
});

// src/commands/reindex.ts
import { Command as Command9 } from "commander";
import { listEntries as listEntries2, updateEntry as updateEntry2 } from "@wikibase/db";
import { generateEmbedding as generateEmbedding4 } from "@wikibase/db/embeddings";
var reindexCommand = new Command9("reindex").description("Backfill embeddings for all entries missing one").action(async () => {
  const all = await listEntries2(1e3);
  const missing = all.filter((e) => !e.embedding);
  if (missing.length === 0) {
    console.log("All entries already have embeddings.");
    return;
  }
  console.log(`Generating embeddings for ${missing.length} entries...`);
  let done = 0;
  for (const entry of missing) {
    const embedding = await generateEmbedding4(
      `${entry.title} ${entry.summary ?? ""} ${entry.content}`
    );
    await updateEntry2(entry.id, { embedding });
    done++;
    process.stdout.write(`\r${done}/${missing.length}`);
  }
  console.log("\nReindex complete.");
});

// src/commands/export.ts
import { Command as Command10 } from "commander";
import { execSync } from "child_process";
import { cpSync, existsSync as existsSync2, rmSync } from "fs";
import { join as join3, resolve } from "path";
var exportCommand = new Command10("export").description("Generate a static site snapshot and copy it to a directory").argument("[outDir]", "Output directory", "./wiki-export").action((outDir) => {
  const webDir = join3(import.meta.dirname, "../../web");
  const builtOut = join3(webDir, "out");
  const dest = resolve(outDir);
  console.log("Building static site...");
  try {
    execSync("pnpm next build", { cwd: webDir, stdio: "inherit" });
  } catch {
    console.error("Build failed.");
    process.exit(1);
  }
  if (!existsSync2(builtOut)) {
    console.error("Build succeeded but no 'out' directory found.");
    process.exit(1);
  }
  if (existsSync2(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(builtOut, dest, { recursive: true });
  console.log(`
Static site exported to: ${dest}`);
  console.log("Serve it with: npx serve " + dest);
});

// src/commands/migrate-blocks.ts
import { Command as Command11 } from "commander";
import { unified } from "unified";
import remarkParse from "remark-parse";
import { toMarkdown } from "mdast-util-to-markdown";
import { getEntryById as getEntryById4 } from "@wikibase/db";
import { createBlock, getBlocksByEntry as getBlocksByEntry2 } from "@wikibase/db/blocks";
import { generateEmbedding as generateEmbedding5 } from "@wikibase/db/embeddings";
function mapNodeType(node) {
  switch (node.type) {
    case "heading":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "image":
      return "image";
    case "code":
      return "code";
    case "blockquote":
      return "quote";
    case "thematicBreak":
      return "divider";
    case "list":
      return "list";
    default:
      return "paragraph";
  }
}
function extractMetadata(node) {
  if (node.type === "heading") return { level: node.depth };
  if (node.type === "code" && node.lang) return { language: node.lang };
  if (node.type === "list") return { ordered: node.ordered ?? false };
  if (node.type === "image") return { src: node.url, alt: node.alt ?? "", title: node.title ?? "" };
  return null;
}
var migrateBlocksCommand = new Command11("migrate-blocks").description("Parse an entry's content into blocks (one-time migration for post entries)").argument("<id>", "Entry UUID").option("--dry-run", "Preview blocks without writing to the database").action(async (id, opts) => {
  const entry = await getEntryById4(id);
  if (!entry) {
    console.error(`No entry found: ${id}`);
    process.exit(1);
  }
  const existingBlocks = await getBlocksByEntry2(id);
  if (existingBlocks.length > 0) {
    console.error(`Entry already has ${existingBlocks.length} block(s) \u2014 skipping to avoid duplicates.`);
    process.exit(1);
  }
  const tree = unified().use(remarkParse).parse(entry.content);
  const nodes = tree.children;
  console.log(`
Entry: ${entry.title}`);
  console.log(`Blocks to create: ${nodes.length}
`);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const type = mapNodeType(node);
    const content = toMarkdown(node).trim();
    const metadata = extractMetadata(node);
    console.log(`  [${i}] ${type}${metadata ? ` ${JSON.stringify(metadata)}` : ""}`);
    console.log(`      ${content.slice(0, 80)}${content.length > 80 ? "\u2026" : ""}`);
    if (!opts.dryRun) {
      const embedding = await generateEmbedding5(content);
      await createBlock({
        entryId: id,
        type,
        content,
        position: i,
        metadata: metadata ?? void 0,
        embedding
      });
    }
  }
  if (!opts.dryRun) {
    console.log(`
\u2713 Created ${nodes.length} blocks for entry ${id}`);
  } else {
    console.log(`
Dry run \u2014 no blocks written.`);
  }
  process.exit(0);
});

// src/commands/import-md.ts
import { readFileSync as readFileSync2 } from "fs";
import { basename, extname } from "path";
import { Command as Command12 } from "commander";
import { input as input3, confirm as confirm3 } from "@inquirer/prompts";
import { unified as unified2 } from "unified";
import remarkParse2 from "remark-parse";
import { toMarkdown as toMarkdown2 } from "mdast-util-to-markdown";
import { createEntry } from "@wikibase/db";
import { createBlock as createBlock2 } from "@wikibase/db/blocks";
import { generateEmbedding as generateEmbedding6 } from "@wikibase/db/embeddings";
function mapNodeType2(node) {
  switch (node.type) {
    case "heading":
      return "heading";
    case "paragraph":
      return "paragraph";
    case "image":
      return "image";
    case "code":
      return "code";
    case "blockquote":
      return "quote";
    case "thematicBreak":
      return "divider";
    case "list":
      return "list";
    default:
      return "paragraph";
  }
}
function extractMetadata2(node) {
  if (node.type === "heading") return { level: node.depth };
  if (node.type === "code" && node.lang) return { language: node.lang };
  if (node.type === "list") return { ordered: node.ordered ?? false };
  if (node.type === "image") return { src: node.url, alt: node.alt ?? "", title: node.title ?? "" };
  return null;
}
var importMdCommand = new Command12("import-md").description("Import a markdown file as a new entry with blocks").argument("<file>", "Path to the markdown file").action(async (file) => {
  let content;
  try {
    content = readFileSync2(file, "utf-8");
  } catch {
    console.error(`Could not read file: ${file}`);
    process.exit(1);
  }
  const defaultTitle = basename(file, extname(file));
  const title = await input3({
    message: "Title:",
    default: defaultTitle
  });
  const tagsInput = await input3({
    message: "Tags (comma-separated, optional):"
  });
  const tags = tagsInput ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean) : [];
  const ok = await confirm3({ message: `Import "${title}" as a draft post?` });
  if (!ok) {
    console.log("Aborted.");
    process.exit(0);
  }
  process.stdout.write("Generating embedding...");
  const embedding = await generateEmbedding6(`${title} ${content}`);
  process.stdout.write(" done\n");
  const entry = await createEntry({
    title,
    type: "post",
    content,
    summary: null,
    tags,
    embedding
  });
  console.log(`Created entry: ${entry.id}`);
  const tree = unified2().use(remarkParse2).parse(content);
  const nodes = tree.children;
  console.log(`Parsing ${nodes.length} block(s)...`);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const type = mapNodeType2(node);
    const blockContent = toMarkdown2(node).trim();
    const metadata = extractMetadata2(node);
    const blockEmbedding = await generateEmbedding6(blockContent);
    await createBlock2({
      entryId: entry.id,
      type,
      content: blockContent,
      position: i,
      metadata: metadata ?? void 0,
      embedding: blockEmbedding
    });
  }
  console.log(`
Imported "${title}" as draft post.`);
  console.log(`Entry ID: ${entry.id}`);
  console.log(`Blocks created: ${nodes.length}`);
});

// src/commands/export-md.ts
import { writeFileSync as writeFileSync2 } from "fs";
import { join as join4, resolve as resolve2 } from "path";
import { Command as Command13 } from "commander";
import { getEntryById as getEntryById5 } from "@wikibase/db";
import { getBlocksByEntry as getBlocksByEntry3 } from "@wikibase/db/blocks";
function slugify(title) {
  return title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/[\s-]+/g, "-").replace(/^-+|-+$/g, "");
}
var exportMdCommand = new Command13("export-md").description("Export an entry as a markdown file").argument("<id>", "Entry UUID").argument("[outDir]", "Output directory (default: current directory)", ".").action(async (id, outDir) => {
  const [entry, entryBlocks] = await Promise.all([
    getEntryById5(id),
    getBlocksByEntry3(id)
  ]);
  if (!entry) {
    console.error(`No entry found: ${id}`);
    process.exit(1);
  }
  const content = entryBlocks.length > 0 ? entryBlocks.map((b) => b.content).join("\n\n") : entry.content;
  const slug = slugify(entry.title) || id;
  const filename = `${slug}.md`;
  const outputPath = resolve2(join4(outDir, filename));
  writeFileSync2(outputPath, content, "utf-8");
  console.log(`Exported "${entry.title}" to: ${outputPath}`);
});

// src/commands/instance.ts
import { Command as Command14 } from "commander";
import { input as input4, select as select3, confirm as confirm4 } from "@inquirer/prompts";
import { join as join5 } from "path";
import { mkdtempSync, rmSync as rmSync2, readdirSync, readFileSync as readFileSync3, writeFileSync as writeFileSync3, mkdirSync as mkdirSync2 } from "fs";
import { tmpdir } from "os";
import Table from "cli-table3";
import { readConfig as readConfig2, addInstance, selectInstance, removeInstance, getDb } from "@wikibase/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";

// src/commands/docker.ts
import { spawnSync } from "child_process";
var CONTAINER_NAME = "ai-wiki-postgres";
var VOLUME_NAME = "ai-wiki-postgres-data";
var DB_URL = "postgresql://aiwiki:aiwiki@127.0.0.1:5499/aiwiki";
function isDockerAvailable() {
  try {
    const result = spawnSync("docker", ["info"], { stdio: "pipe" });
    return result.status === 0;
  } catch {
    return false;
  }
}
function containerExists() {
  try {
    const result = spawnSync(
      "docker",
      [
        "ps",
        "-a",
        "--filter",
        `name=^${CONTAINER_NAME}$`,
        "--format",
        "{{.Names}}"
      ],
      { stdio: "pipe" }
    );
    return (result.stdout?.toString() ?? "").trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}
function containerRunning() {
  try {
    const result = spawnSync(
      "docker",
      [
        "ps",
        "--filter",
        `name=^${CONTAINER_NAME}$`,
        "--format",
        "{{.Names}}"
      ],
      { stdio: "pipe" }
    );
    return (result.stdout?.toString() ?? "").trim() === CONTAINER_NAME;
  } catch {
    return false;
  }
}
async function startDockerPostgres() {
  if (!isDockerAvailable()) {
    throw new Error(
      "Docker is not running or not installed. Start Docker Desktop and try again."
    );
  }
  if (containerRunning()) {
    console.log(`  Container "${CONTAINER_NAME}" is already running.`);
    return DB_URL;
  }
  if (containerExists()) {
    console.log(`  Starting existing container "${CONTAINER_NAME}"...`);
    const start = spawnSync("docker", ["start", CONTAINER_NAME], {
      stdio: "pipe"
    });
    if (start.status !== 0) {
      throw new Error(
        `Failed to start container: ${start.stderr?.toString()}`
      );
    }
  } else {
    console.log(`  Creating container "${CONTAINER_NAME}"...`);
    const run = spawnSync(
      "docker",
      [
        "run",
        "-d",
        "--name",
        CONTAINER_NAME,
        "-e",
        "POSTGRES_USER=aiwiki",
        "-e",
        "POSTGRES_PASSWORD=aiwiki",
        "-e",
        "POSTGRES_DB=aiwiki",
        "-p",
        "5499:5432",
        "-v",
        `${VOLUME_NAME}:/var/lib/postgresql/data`,
        "pgvector/pgvector:pg16"
      ],
      { stdio: "pipe" }
    );
    if (run.status !== 0) {
      throw new Error(
        `Failed to create container: ${run.stderr?.toString()}`
      );
    }
  }
  process.stdout.write("  Waiting for Postgres to be ready");
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1e3));
    process.stdout.write(".");
    try {
      const ready = spawnSync(
        "docker",
        ["exec", CONTAINER_NAME, "pg_isready", "-U", "aiwiki"],
        { stdio: "pipe" }
      );
      if (ready.status === 0) {
        process.stdout.write(" ready.\n");
        return DB_URL;
      }
    } catch {
    }
  }
  throw new Error(
    "Postgres did not become ready in time. Check `docker logs ai-wiki-postgres`."
  );
}

// src/commands/instance.ts
var migrationsFolder = join5(import.meta.dirname, "../migrations");
async function runMigrations(databaseUrl, schemaName) {
  process.env.DATABASE_URL = databaseUrl;
  const { db } = getDb();
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
  const tempDir = mkdtempSync(join5(tmpdir(), "wikibase-migrate-"));
  try {
    const files = readdirSync(migrationsFolder);
    mkdirSync2(tempDir, { recursive: true });
    for (const file of files) {
      const src = join5(migrationsFolder, file);
      const dest = join5(tempDir, file);
      const content = readFileSync3(src, "utf-8");
      const patched = content.replaceAll('"ai_wiki"', `"${schemaName}"`).replaceAll("ai_wiki.", `${schemaName}.`);
      writeFileSync3(dest, patched, "utf-8");
    }
    await migrate(db, { migrationsFolder: tempDir });
  } finally {
    rmSync2(tempDir, { recursive: true, force: true });
  }
}
var instanceCommand = new Command14("instance").description("Manage database instances");
instanceCommand.command("list").description("List all configured instances").action(() => {
  const config = readConfig2();
  if (!config || config.instances.length === 0) {
    console.log("No instances configured. Run `wiki instance add` to get started.");
    return;
  }
  const termWidth = process.stdout.columns ?? 100;
  const hostWidth = Math.max(20, termWidth - 30);
  const table = new Table({
    head: ["", "NAME", "HOST", "SCHEMA", "STATUS"],
    colWidths: [3, 12, hostWidth, 12, 8],
    wordWrap: false,
    style: { head: [], border: [] }
  });
  for (const inst of config.instances) {
    let display = inst.databaseUrl;
    try {
      const u = new URL(inst.databaseUrl);
      display = `${u.protocol}//${u.username}@${u.hostname}${u.pathname}`;
    } catch {
    }
    const active = inst.name === config.selectedInstance;
    table.push([active ? "\u25B6" : "", inst.name, display, inst.schema ?? "ai_wiki", active ? "active" : ""]);
  }
  console.log();
  console.log(table.toString());
  console.log();
});
instanceCommand.command("use <name>").description("Switch to a different instance").action((name) => {
  try {
    selectInstance(name);
    console.log(`Switched to instance "${name}".`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});
instanceCommand.command("add").description("Add a new instance").option("--select", "Make this the active instance after adding").action(async (opts) => {
  const name = await input4({ message: "Instance name:", validate: (v) => v.trim().length > 0 || "Name is required" });
  const dbType = await select3({
    message: "How would you like to connect to PostgreSQL?",
    choices: [
      { name: "Start a local Docker container", value: "docker" },
      { name: "Enter a connection string manually", value: "manual" }
    ]
  });
  let databaseUrl;
  if (dbType === "docker") {
    if (!isDockerAvailable()) {
      console.error("\nDocker is not running or not installed. Start Docker Desktop and try again.\n");
      process.exit(1);
    }
    try {
      databaseUrl = await startDockerPostgres();
    } catch (err) {
      console.error(`
${err.message}
`);
      process.exit(1);
    }
  } else {
    databaseUrl = await input4({
      message: "PostgreSQL connection URL:",
      validate: (v) => v.trim().length > 0 || "URL is required"
    });
  }
  const schemaName = await input4({
    message: "PostgreSQL schema name:",
    default: "wikibase"
  });
  const shouldSelect = opts.select ?? await confirm4({ message: `Make "${name}" the active instance?`, default: true });
  addInstance(name.trim(), databaseUrl.trim(), schemaName.trim(), shouldSelect);
  console.log(`
Instance "${name}" added${shouldSelect ? " and selected" : ""}.`);
  console.log("Running migrations...");
  try {
    await runMigrations(databaseUrl.trim(), schemaName.trim());
    console.log("Migrations complete.");
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  }
});
instanceCommand.command("migrate").description("Run pending migrations against the active instance").action(async () => {
  const config = readConfig2();
  if (!config || config.instances.length === 0) {
    console.error("No instances configured. Run `wiki instance add` first.");
    process.exit(1);
  }
  const instance = config.instances.find((i) => i.name === config.selectedInstance);
  if (!instance) {
    console.error(`Active instance "${config.selectedInstance}" not found.`);
    process.exit(1);
  }
  const schemaName = instance.schema ?? "ai_wiki";
  console.log(`Running migrations against "${config.selectedInstance}" (schema: ${schemaName})...`);
  try {
    await runMigrations(instance.databaseUrl, schemaName);
    console.log("Migrations applied successfully.");
  } catch (err) {
    console.error("Migration failed:", err.message);
    process.exit(1);
  }
});
instanceCommand.command("remove <name>").description("Remove an instance (cannot remove the active instance)").action(async (name) => {
  try {
    const ok = await confirm4({ message: `Remove instance "${name}"?`, default: false });
    if (!ok) return;
    removeInstance(name);
    console.log(`Instance "${name}" removed.`);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
});

// src/index.ts
var program = new Command15();
program.name("wiki").description("Wikibase \u2014 personal knowledge base for AI sessions").version("0.1.0");
program.addCommand(addCommand);
program.addCommand(getCommand);
program.addCommand(searchCommand);
program.addCommand(listCommand);
program.addCommand(deleteCommand);
program.addCommand(updateCommand);
program.addCommand(mcpCommand);
program.addCommand(serveCommand);
program.addCommand(reindexCommand);
program.addCommand(exportCommand);
program.addCommand(migrateBlocksCommand);
program.addCommand(importMdCommand);
program.addCommand(exportMdCommand);
program.addCommand(instanceCommand);
program.parseAsync().then(() => {
  if (!process.argv.includes("serve")) process.exit(0);
});
