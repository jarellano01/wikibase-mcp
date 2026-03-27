import {
  pgSchema,
  uuid,
  text,
  timestamp,
  index,
  customType,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    return `vector(${config?.dimensions ?? 384})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return JSON.parse(value);
  },
});

/**
 * Factory that builds Drizzle schema objects for a given Postgres schema name.
 * Call getDb() to get the pre-built instances tied to the active config.
 */
export function buildSchemaObjects(schemaName: string) {
  const wikiSchema = pgSchema(schemaName);

  const entries = wikiSchema.table(
    "entries",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      title: text("title").notNull(),
      content: text("content").notNull(),
      summary: text("summary"),
      tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
      type: text("type").notNull().default("note"),
      status: text("status").notNull().default("draft"),
      metadata: jsonb("metadata"),
      embedding: vector("embedding", { dimensions: 384 }),
      createdAt: timestamp("created_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true })
        .notNull()
        .defaultNow(),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
    },
    (table) => [
      index("entries_created_at_idx").on(table.createdAt),
      index("entries_type_idx").on(table.type),
    ]
  );

  const blocks = wikiSchema.table(
    "blocks",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      entryId: uuid("entry_id").notNull().references(() => entries.id),
      type: text("type").notNull(),
      content: text("content").notNull(),
      position: integer("position").notNull(),
      metadata: jsonb("metadata"),
      embedding: vector("embedding", { dimensions: 384 }),
      deletedAt: timestamp("deleted_at", { withTimezone: true }),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("blocks_entry_id_idx").on(table.entryId),
      index("blocks_entry_position_idx").on(table.entryId, table.position),
    ]
  );

  const blockRevisions = wikiSchema.table(
    "block_revisions",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      blockId: uuid("block_id").notNull().references(() => blocks.id),
      content: text("content").notNull(),
      source: text("source").notNull(),
      note: text("note"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("block_revisions_block_id_idx").on(table.blockId),
    ]
  );

  const blockComments = wikiSchema.table(
    "block_comments",
    {
      id: uuid("id").primaryKey().defaultRandom(),
      blockId: uuid("block_id").notNull().references(() => blocks.id),
      body: text("body").notNull(),
      resolved: text("resolved").notNull().default("false"),
      createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    },
    (table) => [
      index("block_comments_block_id_idx").on(table.blockId),
    ]
  );

  return { wikiSchema, entries, blocks, blockRevisions, blockComments };
}

// --- Types (don't depend on schema name, inferred from a dummy build) ---

// We need concrete table references for type inference. Use a temporary build
// with the default schema name just to extract types.
const _defaultSchema = buildSchemaObjects("ai_wiki");

export type Entry = typeof _defaultSchema.entries.$inferSelect;
export type NewEntry = typeof _defaultSchema.entries.$inferInsert;
export type Block = typeof _defaultSchema.blocks.$inferSelect;
export type NewBlock = typeof _defaultSchema.blocks.$inferInsert;
export type BlockRevision = typeof _defaultSchema.blockRevisions.$inferSelect;
export type NewBlockRevision = typeof _defaultSchema.blockRevisions.$inferInsert;
export type BlockComment = typeof _defaultSchema.blockComments.$inferSelect;
export type NewBlockComment = typeof _defaultSchema.blockComments.$inferInsert;
