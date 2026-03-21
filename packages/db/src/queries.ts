import { eq, desc, sql, ilike, or, isNotNull, isNull, and } from "drizzle-orm";
import { getDb } from "./client.js";
import { entries } from "./schema.js";
import type { NewEntry, Entry } from "./schema.js";

const notDeleted = isNull(entries.deletedAt);

export async function createEntry(data: NewEntry): Promise<Entry> {
  const db = getDb();
  const [entry] = await db.insert(entries).values(data).returning();
  return entry;
}

export async function getEntryById(id: string): Promise<Entry | null> {
  const db = getDb();
  const [entry] = await db
    .select()
    .from(entries)
    .where(and(eq(entries.id, id), notDeleted))
    .limit(1);
  return entry ?? null;
}

export async function listEntries(limit = 20, offset = 0): Promise<Entry[]> {
  const db = getDb();
  return db
    .select()
    .from(entries)
    .where(notDeleted)
    .orderBy(desc(entries.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function searchEntries(
  query: string,
  queryEmbedding?: number[]
): Promise<Entry[]> {
  const db = getDb();

  if (queryEmbedding) {
    const vectorLiteral = `[${queryEmbedding.join(",")}]`;
    return db
      .select()
      .from(entries)
      .where(and(isNotNull(entries.embedding), notDeleted))
      .orderBy(sql`${entries.embedding} <=> ${vectorLiteral}::vector`)
      .limit(20);
  }

  return db
    .select()
    .from(entries)
    .where(
      and(
        notDeleted,
        or(
          ilike(entries.title, `%${query}%`),
          ilike(entries.content, `%${query}%`),
          ilike(entries.summary, `%${query}%`),
          sql`${entries.tags} && ARRAY[${query}]::text[]`
        )
      )
    )
    .orderBy(desc(entries.createdAt))
    .limit(20);
}

export async function filterEntries(opts: {
  q?: string;
  tags?: string[];
  type?: string;
  limit?: number;
}): Promise<Entry[]> {
  const db = getDb();
  const { q, tags, type, limit = 20 } = opts;
  const conditions: Parameters<typeof and>[0][] = [notDeleted];

  if (q) {
    conditions.push(
      or(
        ilike(entries.title, `%${q}%`),
        ilike(entries.content, `%${q}%`),
        ilike(entries.summary, `%${q}%`),
        sql`${entries.tags} && ARRAY[${q}]::text[]`
      )!
    );
  }

  if (tags && tags.length > 0) {
    conditions.push(
      sql`${entries.tags} @> ARRAY[${sql.join(tags.map((t) => sql`${t}`), sql`, `)}]::text[]`
    );
  }

  if (type) {
    conditions.push(eq(entries.type, type));
  }

  return db
    .select()
    .from(entries)
    .where(and(...conditions))
    .orderBy(desc(entries.createdAt))
    .limit(limit);
}

export async function getSimilarEntries(id: string, limit = 5): Promise<Entry[]> {
  const db = getDb();
  const [entry] = await db
    .select({ embedding: entries.embedding })
    .from(entries)
    .where(and(eq(entries.id, id), notDeleted))
    .limit(1);
  if (!entry?.embedding) return [];
  const vectorLiteral = `[${entry.embedding.join(",")}]`;
  return db
    .select()
    .from(entries)
    .where(and(isNotNull(entries.embedding), isNull(entries.deletedAt), sql`${entries.id} != ${id}`))
    .orderBy(sql`${entries.embedding} <=> ${vectorLiteral}::vector`)
    .limit(limit);
}

export async function deleteEntry(id: string): Promise<boolean> {
  const db = getDb();
  const [entry] = await db
    .update(entries)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(entries.id, id), notDeleted))
    .returning();
  return !!entry;
}

export async function restoreEntry(id: string): Promise<Entry | null> {
  const db = getDb();
  const [entry] = await db
    .update(entries)
    .set({ deletedAt: null, updatedAt: new Date() })
    .where(eq(entries.id, id))
    .returning();
  return entry ?? null;
}

export async function updateEntry(
  id: string,
  data: Partial<NewEntry>
): Promise<Entry | null> {
  const db = getDb();
  const [entry] = await db
    .update(entries)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(entries.id, id), notDeleted))
    .returning();
  return entry ?? null;
}
