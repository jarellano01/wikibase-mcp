import {
  pgSchema,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const reporting = pgSchema("reporting");

// ── Tables ──────────────────────────────────────────────────

export const stagedUploads = reporting.table("staged_uploads", {
  id: serial().primaryKey(),
  fileName: text("file_name").notNull(),
  tableName: text("table_name").notNull(),
  columns: jsonb().notNull(),
  rowCount: integer("row_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).default(
    sql`NOW() + INTERVAL '24 hours'`,
  ),
});

export const reportHistory = reporting.table("report_history", {
  id: serial().primaryKey(),
  question: text().notNull(),
  sqlQueries: jsonb("sql_queries").default(sql`'[]'::jsonb`),
  output: text(),
  tags: text()
    .array()
    .default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
