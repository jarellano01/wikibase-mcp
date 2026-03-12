import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 3 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
