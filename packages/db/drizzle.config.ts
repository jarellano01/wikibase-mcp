import { defineConfig } from "drizzle-kit";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function readActiveInstance(): { databaseUrl: string; schema: string } | null {
  // Check new config path first, fall back to old
  const newPath = join(homedir(), ".config", "wikibase", "config.json");
  const oldPath = join(homedir(), ".config", "ai-wiki", "config.json");
  const configPath = existsSync(newPath) ? newPath : oldPath;

  if (!existsSync(configPath)) return null;
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    // Multi-instance format
    if (config?.instances && config?.selectedInstance) {
      const instance = config.instances.find((i: { name: string }) => i.name === config.selectedInstance);
      if (instance?.databaseUrl) {
        return {
          databaseUrl: instance.databaseUrl,
          schema: instance.schema ?? "ai_wiki",
        };
      }
    }
    // Legacy single-instance format
    if (config?.databaseUrl) {
      return { databaseUrl: config.databaseUrl, schema: "ai_wiki" };
    }
  } catch { /* ignore */ }
  return null;
}

function getDbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const instance = readActiveInstance();
  if (instance) return instance.databaseUrl;
  return ""; // generate doesn't need a connection; migrate will fail with a clear error
}

function getSchemaFilter(): string[] {
  if (process.env.DATABASE_URL) return ["ai_wiki"]; // env override: assume default schema
  const instance = readActiveInstance();
  return [instance?.schema ?? "ai_wiki"];
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "../../apps/cli/migrations",
  dialect: "postgresql",
  schemaFilter: getSchemaFilter(),
  dbCredentials: {
    url: getDbUrl(),
  },
});
