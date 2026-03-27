import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { buildSchemaObjects } from "./schema.js";
import { getDatabaseUrl, getSchemaName } from "./config.js";

type SchemaObjects = ReturnType<typeof buildSchemaObjects>;

interface DbCache {
  schemaName: string;
  db: ReturnType<typeof drizzle>;
  schema: SchemaObjects;
}

let _cache: DbCache | null = null;

export function getDb(): { db: ReturnType<typeof drizzle>; schema: SchemaObjects } {
  const currentSchemaName = getSchemaName();

  if (_cache && _cache.schemaName === currentSchemaName) {
    return { db: _cache.db, schema: _cache.schema };
  }

  const schema = buildSchemaObjects(currentSchemaName);
  const client = postgres(getDatabaseUrl());
  const db = drizzle(client, { schema });

  _cache = { schemaName: currentSchemaName, db, schema };
  return { db, schema };
}

export function resetDb(): void {
  _cache = null;
}
