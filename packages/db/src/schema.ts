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

export const aiWikiSchema = pgSchema("ai_wiki");

export const entries = aiWikiSchema.table(
  "entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    summary: text("summary"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    type: text("type").notNull().default("note"),
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

export type Entry = typeof entries.$inferSelect;
export type NewEntry = typeof entries.$inferInsert;

export const blocks = aiWikiSchema.table(
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

export const blockRevisions = aiWikiSchema.table(
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

export type Block = typeof blocks.$inferSelect;
export type NewBlock = typeof blocks.$inferInsert;
export type BlockRevision = typeof blockRevisions.$inferSelect;
export type NewBlockRevision = typeof blockRevisions.$inferInsert;

export const blockComments = aiWikiSchema.table(
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

export type BlockComment = typeof blockComments.$inferSelect;
export type NewBlockComment = typeof blockComments.$inferInsert;
