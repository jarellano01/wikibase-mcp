import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { getDatabaseUrl } from "./config.js";

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null;

export function getDb() {
  if (_db) return _db;

  const client = postgres(getDatabaseUrl());
  _db = drizzle(client, { schema });
  return _db;
}
