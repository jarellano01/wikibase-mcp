import { Command } from "commander";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { execFileSync } from "child_process";
import { readConfig } from "@ai-wiki/db";

export const mcpCommand = new Command("mcp")
  .description("Manage the MCP server");

mcpCommand
  .command("install")
  .description("Register the MCP server in Claude Desktop and/or Claude Code")
  .option("--desktop", "Install for Claude Desktop only")
  .option("--code", "Install for Claude Code only")
  .action((opts: { desktop?: boolean; code?: boolean }) => {
    const config = readConfig();
    if (!config || config.instances.length === 0) {
      console.log("No instances configured. Run `wiki instance add` first to set up a database.");
      process.exit(1);
    }

    let command = "wiki-mcp";
    try {
      command = execFileSync("which", ["wiki-mcp"], { encoding: "utf-8" }).trim();
    } catch { /* fall back to bare name */ }

    const installDesktop = opts.desktop || (!opts.desktop && !opts.code);
    const installCode = opts.code || (!opts.desktop && !opts.code);

    if (installDesktop) {
      const dir = join(homedir(), "Library", "Application Support", "Claude");
      const path = join(dir, "claude_desktop_config.json");
      let cfg: Record<string, unknown> = {};
      if (existsSync(path)) {
        cfg = JSON.parse(readFileSync(path, "utf-8"));
      } else {
        mkdirSync(dir, { recursive: true });
      }
      const servers = (cfg.mcpServers as Record<string, unknown>) ?? {};
      servers["ai-wiki"] = { command };
      cfg.mcpServers = servers;
      writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`Claude Desktop: registered in ${path}`);
    }

    if (installCode) {
      const path = join(homedir(), ".claude.json");
      let cfg: Record<string, unknown> = {};
      if (existsSync(path)) {
        cfg = JSON.parse(readFileSync(path, "utf-8"));
      }
      const servers = (cfg.mcpServers as Record<string, unknown>) ?? {};
      servers["ai-wiki"] = { type: "stdio", command, args: [], env: {} };
      cfg.mcpServers = servers;
      writeFileSync(path, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`Claude Code:    registered in ${path}`);
    }

    console.log("\nRestart Claude Desktop / reload Claude Code to activate.");
  });

