import { Command } from "commander";
import { input, select, confirm } from "@inquirer/prompts";
import { join } from "path";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import Table from "cli-table3";
import { readConfig, addInstance, selectInstance, removeInstance, getDb } from "@wikibase/db";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { sql } from "drizzle-orm";
import { isDockerAvailable, startDockerPostgres } from "./docker.js";

const migrationsFolder = join(import.meta.dirname, "../migrations");

async function runMigrations(databaseUrl: string, schemaName: string): Promise<void> {
  process.env.DATABASE_URL = databaseUrl;
  const { db } = getDb();
  await db.execute(sql`CREATE EXTENSION IF NOT EXISTS vector`);

  // Copy migration files to a temp directory, replacing "ai_wiki" with schemaName
  // so migrations create the correct schema when schemaName differs from the default.
  const tempDir = mkdtempSync(join(tmpdir(), "wikibase-migrate-"));
  try {
    const files = readdirSync(migrationsFolder);
    mkdirSync(tempDir, { recursive: true });
    for (const file of files) {
      const src = join(migrationsFolder, file);
      const dest = join(tempDir, file);
      const content = readFileSync(src, "utf-8");
      // Replace all occurrences of the default schema name with the target schema
      const patched = content.replaceAll('"ai_wiki"', `"${schemaName}"`).replaceAll("ai_wiki.", `${schemaName}.`);
      writeFileSync(dest, patched, "utf-8");
    }
    await migrate(db, { migrationsFolder: tempDir });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export const instanceCommand = new Command("instance")
  .description("Manage database instances");

instanceCommand
  .command("list")
  .description("List all configured instances")
  .action(() => {
    const config = readConfig();
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
      style: { head: [], border: [] },
    });

    for (const inst of config.instances) {
      let display = inst.databaseUrl;
      try {
        const u = new URL(inst.databaseUrl);
        display = `${u.protocol}//${u.username}@${u.hostname}${u.pathname}`;
      } catch { /* leave as-is */ }
      const active = inst.name === config.selectedInstance;
      table.push([active ? "▶" : "", inst.name, display, inst.schema ?? "ai_wiki", active ? "active" : ""]);
    }

    console.log();
    console.log(table.toString());
    console.log();
  });

instanceCommand
  .command("use <name>")
  .description("Switch to a different instance")
  .action((name: string) => {
    try {
      selectInstance(name);
      console.log(`Switched to instance "${name}".`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });

instanceCommand
  .command("add")
  .description("Add a new instance")
  .option("--select", "Make this the active instance after adding")
  .action(async (opts: { select?: boolean }) => {
    const name = await input({ message: "Instance name:", validate: (v) => v.trim().length > 0 || "Name is required" });

    const dbType = await select({
      message: "How would you like to connect to PostgreSQL?",
      choices: [
        { name: "Start a local Docker container", value: "docker" },
        { name: "Enter a connection string manually", value: "manual" },
      ],
    });

    let databaseUrl: string;
    if (dbType === "docker") {
      if (!isDockerAvailable()) {
        console.error("\nDocker is not running or not installed. Start Docker Desktop and try again.\n");
        process.exit(1);
      }
      try {
        databaseUrl = await startDockerPostgres();
      } catch (err) {
        console.error(`\n${(err as Error).message}\n`);
        process.exit(1);
      }
    } else {
      databaseUrl = await input({
        message: "PostgreSQL connection URL:",
        validate: (v) => v.trim().length > 0 || "URL is required",
      });
    }

    const schemaName = await input({
      message: "PostgreSQL schema name:",
      default: "wikibase",
    });

    const shouldSelect = opts.select ?? await confirm({ message: `Make "${name}" the active instance?`, default: true });
    addInstance(name.trim(), databaseUrl.trim(), schemaName.trim(), shouldSelect);
    console.log(`\nInstance "${name}" added${shouldSelect ? " and selected" : ""}.`);

    console.log("Running migrations...");
    try {
      await runMigrations(databaseUrl.trim(), schemaName.trim());
      console.log("Migrations complete.");
    } catch (err) {
      console.error("Migration failed:", err);
      process.exit(1);
    }
  });

instanceCommand
  .command("migrate")
  .description("Run pending migrations against the active instance")
  .action(async () => {
    const config = readConfig();
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
      console.error("Migration failed:", (err as Error).message);
      process.exit(1);
    }
  });

instanceCommand
  .command("remove <name>")
  .description("Remove an instance (cannot remove the active instance)")
  .action(async (name: string) => {
    try {
      const ok = await confirm({ message: `Remove instance "${name}"?`, default: false });
      if (!ok) return;
      removeInstance(name);
      console.log(`Instance "${name}" removed.`);
    } catch (err) {
      console.error((err as Error).message);
      process.exit(1);
    }
  });
