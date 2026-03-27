import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface WikiInstance {
  name: string;
  databaseUrl: string;
  schema?: string;
}

export interface WikiConfig {
  instances: WikiInstance[];
  selectedInstance: string;
}

const NEW_CONFIG_DIR = join(homedir(), ".config", "wikibase");
const OLD_CONFIG_DIR = join(homedir(), ".config", "ai-wiki");
const NEW_CONFIG_PATH = join(NEW_CONFIG_DIR, "config.json");
const OLD_CONFIG_PATH = join(OLD_CONFIG_DIR, "config.json");

// Resolve which config path to use: prefer new, fall back to old
function resolveConfigPath(): string {
  if (existsSync(NEW_CONFIG_PATH)) return NEW_CONFIG_PATH;
  if (existsSync(OLD_CONFIG_PATH)) return OLD_CONFIG_PATH;
  // Neither exists — use new path (will be created on write)
  return NEW_CONFIG_PATH;
}

// Export CONFIG_PATH as the resolved path at module load time
export const CONFIG_PATH = resolveConfigPath();

export function readConfig(): WikiConfig | null {
  const path = resolveConfigPath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, "utf-8"));
    // Backward compatibility: migrate old { databaseUrl } format
    if (raw.databaseUrl && !raw.instances) {
      return {
        instances: [{ name: "default", databaseUrl: raw.databaseUrl }],
        selectedInstance: "default",
      };
    }
    return raw as WikiConfig;
  } catch {
    return null;
  }
}

export function writeConfig(config: WikiConfig): void {
  // Always write to the new path
  mkdirSync(NEW_CONFIG_DIR, { recursive: true });
  writeFileSync(NEW_CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  // If old path exists and new path was just written, migrate by removing old
  // (we leave old in place for now — future cleanup)
}

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const config = readConfig();
  if (!config) throw new Error("Database not configured. Run `wiki instance add` to get started.");

  const instance = config.instances.find((i) => i.name === config.selectedInstance);
  if (!instance) throw new Error(`Instance "${config.selectedInstance}" not found. Run \`wiki instance list\` to see available instances.`);

  return instance.databaseUrl;
}

export function getSchemaName(): string {
  const config = readConfig();
  if (!config) return "ai_wiki";

  const instance = config.instances.find((i) => i.name === config.selectedInstance);
  return instance?.schema ?? "ai_wiki";
}

export function addInstance(name: string, databaseUrl: string, schema?: string, select = false): WikiConfig {
  const config = readConfig() ?? { instances: [], selectedInstance: "" };
  const existing = config.instances.findIndex((i) => i.name === name);
  const entry: WikiInstance = { name, databaseUrl, ...(schema ? { schema } : {}) };
  if (existing >= 0) {
    config.instances[existing] = entry;
  } else {
    config.instances.push(entry);
  }
  if (select || !config.selectedInstance) config.selectedInstance = name;
  writeConfig(config);
  return config;
}

export function selectInstance(name: string): WikiConfig {
  const config = readConfig();
  if (!config) throw new Error("No config found. Run `wiki instance add` first.");
  if (!config.instances.find((i) => i.name === name)) {
    throw new Error(`Instance "${name}" not found.`);
  }
  config.selectedInstance = name;
  writeConfig(config);
  return config;
}

export function removeInstance(name: string): WikiConfig {
  const config = readConfig();
  if (!config) throw new Error("No config found.");
  if (config.selectedInstance === name) {
    throw new Error(`Cannot remove the active instance. Switch to another instance first with \`wiki instance use <name>\`.`);
  }
  config.instances = config.instances.filter((i) => i.name !== name);
  writeConfig(config);
  return config;
}
