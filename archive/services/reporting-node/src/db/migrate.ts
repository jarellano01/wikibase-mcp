import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runMigrations(connectionString: string) {
  const client = postgres(connectionString, { max: 1 });

  // Ensure reporting schema exists before running migrations
  await client`CREATE SCHEMA IF NOT EXISTS reporting`;

  const db = drizzle(client);

  // In Docker: /app/drizzle  |  Local dev: ../../drizzle relative to src/db/
  let migrationsFolder = path.resolve(__dirname, "../../drizzle");
  if (!existsSync(migrationsFolder)) {
    migrationsFolder = path.resolve(process.cwd(), "drizzle");
  }

  await migrate(db, { migrationsFolder });
  await client.end();
  console.log("Migrations completed successfully");
}

// Allow standalone execution: tsx src/db/migrate.ts
const entryFile = process.argv[1];
if (entryFile && import.meta.url.endsWith(entryFile.replace(/\\/g, "/"))) {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL required");
    process.exit(1);
  }
  runMigrations(url).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
