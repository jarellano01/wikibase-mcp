import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 3 });
  return drizzle(client, { schema });
}

/** Raw postgres.js client for dynamic SQL (staging tables, target queries). */
export function createRawClient(connectionString: string, opts?: { max?: number }) {
  return postgres(connectionString, { max: opts?.max ?? 3 });
}

export type Db = ReturnType<typeof createDb>;
export type RawClient = ReturnType<typeof createRawClient>;
