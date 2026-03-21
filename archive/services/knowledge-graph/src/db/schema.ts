import {
  pgSchema,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  customType,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const kg = pgSchema("knowledge_graph");

/** pgvector vector(768) column type */
export const vector768 = customType<{
  data: number[];
  driverParam: string;
}>({
  dataType() {
    return "vector(768)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: unknown): number[] {
    if (typeof value === "string") {
      return value
        .replace(/[\[\]]/g, "")
        .split(",")
        .map(Number);
    }
    return value as number[];
  },
});

// ── Tables ──────────────────────────────────────────────────

export const knowledgeBase = kg.table(
  "knowledge_base",
  {
    id: serial().primaryKey(),
    category: text().notNull(),
    key: text().notNull().unique(),
    content: text().notNull(),
    embedding: vector768("embedding"),
    scope: text().notNull().default("global"),
    tags: text()
      .array()
      .default(sql`'{}'::text[]`),
    source: text().notNull().default("manual"),
    sourceFile: text("source_file"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_kb_scope").on(t.scope)],
);

export const sessions = kg.table("sessions", {
  id: serial().primaryKey(),
  title: text().notNull(),
  scope: text().notNull().default("global"),
  userName: text("user_name"),
  status: text().notNull().default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sessionEntries = kg.table(
  "session_entries",
  {
    id: serial().primaryKey(),
    sessionId: integer("session_id")
      .notNull()
      .references(() => sessions.id),
    sequence: integer().notNull(),
    entryType: text("entry_type").notNull(),
    content: text().notNull(),
    embedding: vector768("embedding"),
    metadata: jsonb().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("uq_session_sequence").on(t.sessionId, t.sequence),
  ],
);

export const knowledgeCandidates = kg.table("knowledge_candidates", {
  id: serial().primaryKey(),
  category: text().notNull(),
  key: text().notNull(),
  content: text().notNull(),
  embedding: vector768("embedding"),
  rationale: text(),
  scope: text().notNull().default("global"),
  tags: text()
    .array()
    .default(sql`'{}'::text[]`),
  sessionId: integer("session_id").references(() => sessions.id),
  status: text().notNull().default("pending"),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
