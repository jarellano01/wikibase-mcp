import { defineConfig } from "drizzle-kit";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

function getDbUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const configPath = join(homedir(), ".config", "ai-wiki", "config.json");
  if (existsSync(configPath)) {
    const config = JSON.parse(readFileSync(configPath, "utf-8"));
    if (config?.databaseUrl) return config.databaseUrl;
  }
  return ""; // generate doesn't need a connection; migrate will fail with a clear error
}

export default defineConfig({
  schema: "./src/schema.ts",
  out: "../../apps/cli/migrations",
  dialect: "postgresql",
  schemaFilter: ["ai_wiki"],
  dbCredentials: {
    url: getDbUrl(),
  },
});
