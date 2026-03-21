import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface WikiConfig {
  databaseUrl: string;
}

const CONFIG_DIR = join(homedir(), ".config", "ai-wiki");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function readConfig(): WikiConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf-8")) as WikiConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: WikiConfig): void {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getDatabaseUrl(): string {
  // Env var takes precedence (useful for CI or overrides)
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const config = readConfig();
  if (config?.databaseUrl) return config.databaseUrl;

  throw new Error(
    "Database not configured. Run `wiki setup` to get started."
  );
}

export { CONFIG_PATH };
