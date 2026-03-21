import { Command } from "commander";
import { input } from "@inquirer/prompts";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { writeConfig, readConfig, CONFIG_PATH, getDb } from "@ai-wiki/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";

// Works in dev (tsx) and when installed globally (dist/)
// tsup bundles to dist/index.js, so import.meta.dirname = apps/cli/dist/
// ../migrations resolves to apps/cli/migrations/ — where drizzle-kit outputs files
const migrationsFolder = join(import.meta.dirname, "../migrations");

export const setupCommand = new Command("setup")
  .description("First-time setup: configure database and register MCP server")
  .action(async () => {
    console.log("ai-wiki setup\n");

    const existing = readConfig();

    const dbUrl = await input({
      message: "PostgreSQL connection URL:",
      default: existing?.databaseUrl ?? process.env.DATABASE_URL,
    });

    // Save to ~/.config/ai-wiki/config.json
    writeConfig({ databaseUrl: dbUrl });
    console.log(`Config saved to ${CONFIG_PATH}`);

    // Run migrations programmatically (works in dev and global install)
    console.log("\nRunning database migrations...");
    try {
      process.env.DATABASE_URL = dbUrl;
      const db = getDb();
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);
      await migrate(db, { migrationsFolder });
      console.log("Migrations complete.");
    } catch (err) {
      console.error("Migration failed:", err);
      process.exit(1);
    }

    // Register MCP server in Claude Desktop config
    const claudeConfigDir = join(
      homedir(),
      "Library",
      "Application Support",
      "Claude"
    );
    const claudeConfigPath = join(claudeConfigDir, "claude_desktop_config.json");

    let claudeConfig: Record<string, unknown> = {};
    if (existsSync(claudeConfigPath)) {
      claudeConfig = JSON.parse(readFileSync(claudeConfigPath, "utf-8"));
    } else {
      mkdirSync(claudeConfigDir, { recursive: true });
    }

    // Resolve absolute path to wiki-mcp so Claude Desktop/Code can find it
    // regardless of PATH at spawn time
    let mcpCommand = "wiki-mcp";
    try {
      mcpCommand = execFileSync("which", ["wiki-mcp"], { encoding: "utf-8" }).trim();
    } catch {
      // fall back to bare command name if which fails
    }

    const mcpServers = (claudeConfig.mcpServers as Record<string, unknown>) ?? {};
    mcpServers["ai-wiki"] = { command: mcpCommand };
    claudeConfig.mcpServers = mcpServers;

    writeFileSync(claudeConfigPath, JSON.stringify(claudeConfig, null, 2) + "\n");
    console.log(`\nMCP server registered in ${claudeConfigPath}`);
    console.log("Restart Claude Desktop to activate.\n");
    console.log("Setup complete. Run `wiki add` to create your first entry.");
  });
