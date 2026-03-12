export interface Config {
  databaseUrl: string;
  apiKey: string;
  gcpProjectId: string;
  gcpLocation: string;
  port: number;
}

export function loadConfig(): Config {
  const databaseUrl = process.env.DATABASE_URL;
  const apiKey = process.env.API_KEY;
  const gcpProjectId = process.env.GCP_PROJECT_ID;

  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!apiKey) throw new Error("API_KEY is required");
  if (!gcpProjectId) throw new Error("GCP_PROJECT_ID is required");

  return {
    databaseUrl,
    apiKey,
    gcpProjectId,
    gcpLocation: process.env.GCP_LOCATION || "us-central1",
    port: parseInt(process.env.PORT || "8080", 10),
  };
}
