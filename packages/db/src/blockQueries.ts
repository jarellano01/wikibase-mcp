import { eq, desc, sql, isNull, and, asc } from "drizzle-orm";
import { getDb } from "./client.js";
import { entries, blocks, blockRevisions, blockComments } from "./schema.js";
import type { Block, NewBlock, BlockComment } from "./schema.js";

// Dynamic import so web/Next.js builds don't pull in @huggingface/transformers
async function getEmbedding(text: string): Promise<number[]> {
  const { generateEmbedding } = await import("./embeddings.js");
  return generateEmbedding(text);
}

const notDeleted = isNull(blocks.deletedAt);

// --- Post metadata helpers ---
// Post-specific fields are stored in entries.metadata JSONB as:
// { slug, status, canonical, publishedAt }

export interface PostMeta {
  slug?: string;
  canonical?: string;
  publishedAt?: string | null;
}

export async function getPostMeta(entryId: string): Promise<PostMeta | null> {
  const db = getDb();
  const [row] = await db
    .select({ metadata: entries.metadata })
    .from(entries)
    .where(eq(entries.id, entryId))
    .limit(1);
  return (row?.metadata as PostMeta) ?? null;
}

export async function updatePostMeta(entryId: string, meta: Partial<PostMeta>): Promise<void> {
  const db = getDb();
  await db
    .update(entries)
    .set({
      metadata: sql`COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(meta)}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(entries.id, entryId));
}

// --- Block CRUD ---

export async function createBlock(
  data: NewBlock & { generateEmbeddingForContent?: boolean }
): Promise<Block> {
  const db = getDb();
  const { generateEmbeddingForContent, ...blockData } = data;
  if (generateEmbeddingForContent && blockData.content) {
    blockData.embedding = await getEmbedding(blockData.content);
  }
  const [block] = await db.insert(blocks).values(blockData).returning();
  return block;
}

export async function getBlock(id: string): Promise<Block | null> {
  const db = getDb();
  const [block] = await db
    .select()
    .from(blocks)
    .where(eq(blocks.id, id))
    .limit(1);
  return block ?? null;
}

export async function getBlocksByEntry(entryId: string): Promise<Block[]> {
  const db = getDb();
  return db
    .select()
    .from(blocks)
    .where(and(eq(blocks.entryId, entryId), notDeleted))
    .orderBy(asc(blocks.position));
}

export async function getBlockWithContext(id: string): Promise<{
  prev: Block | null;
  target: Block | null;
  next: Block | null;
}> {
  const db = getDb();
  const [target] = await db.select().from(blocks).where(eq(blocks.id, id)).limit(1);
  if (!target) return { prev: null, target: null, next: null };

  const [prev] = await db
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.entryId, target.entryId),
        notDeleted,
        sql`${blocks.position} < ${target.position}`
      )
    )
    .orderBy(desc(blocks.position))
    .limit(1);

  const [next] = await db
    .select()
    .from(blocks)
    .where(
      and(
        eq(blocks.entryId, target.entryId),
        notDeleted,
        sql`${blocks.position} > ${target.position}`
      )
    )
    .orderBy(asc(blocks.position))
    .limit(1);

  return { prev: prev ?? null, target, next: next ?? null };
}

// --- Block update with revision snapshot ---

export async function updateBlock(
  id: string,
  content: string,
  source: "human" | "ai-rewrite" | "ai-suggest" | "restructure",
  note?: string
): Promise<Block | null> {
  const db = getDb();
  const existing = await getBlock(id);
  if (!existing) return null;

  const embedding = await getEmbedding(content);

  return db.transaction(async (tx) => {
    // Snapshot current content before overwriting
    await tx.insert(blockRevisions).values({
      blockId: id,
      content: existing.content,
      source,
      note,
    });
    const [updated] = await tx
      .update(blocks)
      .set({ content, embedding, updatedAt: new Date() })
      .where(eq(blocks.id, id))
      .returning();
    return updated ?? null;
  });
}

export async function updateBlockMetadata(
  id: string,
  metadata: Record<string, unknown>
): Promise<Block | null> {
  const db = getDb();
  const [updated] = await db
    .update(blocks)
    .set({ metadata, updatedAt: new Date() })
    .where(and(eq(blocks.id, id), notDeleted))
    .returning();
  return updated ?? null;
}

export async function softDeleteBlock(id: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .update(blocks)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(blocks.id, id), notDeleted))
    .returning();
  return !!row;
}

// --- Reorder ---

export async function reorderBlocks(
  entryId: string,
  orderedIds: string[]
): Promise<void> {
  const db = getDb();
  const existing = await getBlocksByEntry(entryId);

  await db.transaction(async (tx) => {
    // Snapshot all affected blocks before reordering
    for (const blockId of orderedIds) {
      const block = existing.find((b) => b.id === blockId);
      if (!block) continue;
      await tx.insert(blockRevisions).values({
        blockId,
        content: block.content,
        source: "restructure",
      });
    }

    // Apply new positions
    for (let i = 0; i < orderedIds.length; i++) {
      await tx
        .update(blocks)
        .set({ position: i, updatedAt: new Date() })
        .where(eq(blocks.id, orderedIds[i]));
    }
  });
}

// --- Rollback ---

export async function rollbackBlock(blockId: string): Promise<Block | null> {
  const db = getDb();
  const [lastHuman] = await db
    .select()
    .from(blockRevisions)
    .where(
      and(eq(blockRevisions.blockId, blockId), eq(blockRevisions.source, "human"))
    )
    .orderBy(desc(blockRevisions.createdAt))
    .limit(1);

  if (!lastHuman) return null;
  return updateBlock(blockId, lastHuman.content, "human", "rollback to last human revision");
}

// --- Duplicate detection ---

export async function findDuplicateBlocks(
  entryId: string,
  threshold = 0.85
): Promise<
  Array<{
    blockA: string;
    blockB: string;
    contentA: string;
    contentB: string;
    similarity: number;
  }>
> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT
      a.id AS block_a,
      b.id AS block_b,
      a.content AS content_a,
      b.content AS content_b,
      1 - (a.embedding <=> b.embedding) AS similarity
    FROM ai_wiki.blocks a
    JOIN ai_wiki.blocks b ON a.entry_id = b.entry_id AND a.id < b.id
    WHERE a.entry_id = ${entryId}
      AND a.deleted_at IS NULL
      AND b.deleted_at IS NULL
      AND a.embedding IS NOT NULL
      AND b.embedding IS NOT NULL
      AND 1 - (a.embedding <=> b.embedding) > ${threshold}
    ORDER BY similarity DESC
  `);
  return (
    Array.from(rows) as Array<{
      block_a: string;
      block_b: string;
      content_a: string;
      content_b: string;
      similarity: number;
    }>
  ).map((r) => ({
    blockA: r.block_a,
    blockB: r.block_b,
    contentA: r.content_a,
    contentB: r.content_b,
    similarity: r.similarity,
  }));
}

// --- Block comments ---

export async function addBlockComment(blockId: string, body: string): Promise<BlockComment> {
  const db = getDb();
  const [comment] = await db.insert(blockComments).values({ blockId, body }).returning();
  return comment;
}

export async function getCommentsByBlock(blockId: string): Promise<BlockComment[]> {
  const db = getDb();
  return db
    .select()
    .from(blockComments)
    .where(eq(blockComments.blockId, blockId))
    .orderBy(asc(blockComments.createdAt));
}

export async function getUnresolvedCommentsByEntry(entryId: string): Promise<
  Array<BlockComment & { blockPosition: number; blockType: string }>
> {
  const db = getDb();
  const rows = await db
    .select({
      id: blockComments.id,
      blockId: blockComments.blockId,
      body: blockComments.body,
      resolved: blockComments.resolved,
      createdAt: blockComments.createdAt,
      updatedAt: blockComments.updatedAt,
      blockPosition: blocks.position,
      blockType: blocks.type,
    })
    .from(blockComments)
    .innerJoin(blocks, eq(blockComments.blockId, blocks.id))
    .where(
      and(
        eq(blocks.entryId, entryId),
        eq(blockComments.resolved, "false")
      )
    )
    .orderBy(asc(blocks.position), asc(blockComments.createdAt));
  return rows;
}

export async function resolveComment(id: string): Promise<BlockComment | null> {
  const db = getDb();
  const [updated] = await db
    .update(blockComments)
    .set({ resolved: "true", updatedAt: new Date() })
    .where(eq(blockComments.id, id))
    .returning();
  return updated ?? null;
}

// --- Canonical assembly ---

export async function assembleCanonical(entryId: string): Promise<string> {
  const db = getDb();
  const activeBlocks = await getBlocksByEntry(entryId);

  const parts = activeBlocks
    .map((b) => {
      if (b.type === "image") {
        const meta = b.metadata as { src?: string; alt?: string; caption?: string } | null;
        if (!meta?.src) return "";
        const imgLine = `![${meta.alt ?? ""}](${meta.src})`;
        return meta.caption ? `${imgLine}\n*${meta.caption}*` : imgLine;
      }
      return b.content;
    })
    .filter(Boolean);

  const canonical = parts.join("\n\n");

  await updatePostMeta(entryId, { canonical });
  // Write compiled markdown to entries.content so the web page can render
  // published posts without querying blocks at all.
  await db
    .update(entries)
    .set({ content: canonical, updatedAt: new Date() })
    .where(eq(entries.id, entryId));

  return canonical;
}
