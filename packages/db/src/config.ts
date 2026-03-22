import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface WikiInstance {
  name: string;
  databaseUrl: string;
}

export interface WikiConfig {
  instances: WikiInstance[];
  selectedInstance: string;
}

const CONFIG_DIR = join(homedir(), ".config", "ai-wiki");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export function readConfig(): WikiConfig | null {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
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
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

export function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  const config = readConfig();
  if (!config) throw new Error("Database not configured. Run `wiki setup` to get started.");

  const instance = config.instances.find((i) => i.name === config.selectedInstance);
  if (!instance) throw new Error(`Instance "${config.selectedInstance}" not found. Run \`wiki instance list\` to see available instances.`);

  return instance.databaseUrl;
}

export function addInstance(name: string, databaseUrl: string, select = false): WikiConfig {
  const config = readConfig() ?? { instances: [], selectedInstance: "" };
  const existing = config.instances.findIndex((i) => i.name === name);
  if (existing >= 0) {
    config.instances[existing] = { name, databaseUrl };
  } else {
    config.instances.push({ name, databaseUrl });
  }
  if (select || !config.selectedInstance) config.selectedInstance = name;
  writeConfig(config);
  return config;
}

export function selectInstance(name: string): WikiConfig {
  const config = readConfig();
  if (!config) throw new Error("No config found. Run `wiki setup` first.");
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

export { CONFIG_PATH };
