export interface Config {
  databaseUrl: string;
  targetDatabaseUrl: string;
  apiKey: string;
  port: number;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  const targetDatabaseUrl = process.env.TARGET_DATABASE_URL ?? "";
  const apiKey = process.env.API_KEY ?? "";
  const port = parseInt(process.env.PORT ?? "8080", 10);

  const missing: string[] = [];
  if (!databaseUrl) missing.push("DATABASE_URL");
  if (!targetDatabaseUrl) missing.push("TARGET_DATABASE_URL");
  if (!apiKey) missing.push("API_KEY");
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  return { databaseUrl, targetDatabaseUrl, apiKey, port };
}
