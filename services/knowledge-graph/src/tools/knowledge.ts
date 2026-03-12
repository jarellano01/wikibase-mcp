import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sql, eq, and, inArray, like } from "drizzle-orm";
import type { Db } from "../db/index.js";
import type { Config } from "../config.js";
import { embedText } from "../embeddings.js";
import { knowledgeBase, knowledgeCandidates } from "../db/schema.js";

export function registerKnowledgeTools(
  server: McpServer,
  db: Db,
  config: Config,
) {
  server.tool(
    "get_knowledge",
    "Semantic search over the knowledge base with optional filters",
    {
      query: z.string().describe("Text to search for semantically"),
      category: z.string().optional().describe("Filter by category"),
      scope: z.string().optional().describe("Filter by scope"),
      tags: z.array(z.string()).optional().describe("Filter by tags"),
      limit: z.number().optional().default(10).describe("Max results"),
    },
    async ({ query, category, scope, tags, limit }) => {
      const embedding = await embedText(
        query,
        config.gcpProjectId,
        config.gcpLocation,
      );
      const vectorStr = `[${embedding.join(",")}]`;

      const conditions: ReturnType<typeof eq>[] = [];
      if (scope) {
        conditions.push(inArray(knowledgeBase.scope, [scope, "global"]));
      }
      if (category) {
        conditions.push(eq(knowledgeBase.category, category));
      }
      if (tags && tags.length > 0) {
        conditions.push(
          sql`${knowledgeBase.tags} && ARRAY[${sql.join(
            tags.map((t) => sql`${t}`),
            sql`, `,
          )}]::text[]`,
        );
      }

      const results = await db
        .select({
          id: knowledgeBase.id,
          category: knowledgeBase.category,
          key: knowledgeBase.key,
          content: knowledgeBase.content,
          scope: knowledgeBase.scope,
          tags: knowledgeBase.tags,
        })
        .from(knowledgeBase)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(sql`embedding <=> ${vectorStr}::vector`)
        .limit(limit ?? 10);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "review_knowledge",
    "Approve or reject a knowledge candidate",
    {
      candidate_id: z.number().describe("ID of the candidate to review"),
      action: z.enum(["approve", "reject"]).describe("Action to take"),
      reviewer: z.string().describe("Name of the reviewer"),
    },
    async ({ candidate_id, action, reviewer }) => {
      if (action === "reject") {
        await db
          .update(knowledgeCandidates)
          .set({
            status: "rejected",
            reviewedBy: reviewer,
            reviewedAt: new Date(),
          })
          .where(eq(knowledgeCandidates.id, candidate_id));

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ status: "rejected", candidate_id }),
            },
          ],
        };
      }

      // Approve: fetch candidate, embed, upsert into knowledge_base
      const [candidate] = await db
        .select()
        .from(knowledgeCandidates)
        .where(eq(knowledgeCandidates.id, candidate_id));

      if (!candidate) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Candidate not found" }),
            },
          ],
        };
      }

      const embedding = await embedText(
        candidate.content,
        config.gcpProjectId,
        config.gcpLocation,
      );

      await db
        .insert(knowledgeBase)
        .values({
          category: candidate.category,
          key: candidate.key,
          content: candidate.content,
          embedding,
          scope: candidate.scope,
          tags: candidate.tags,
          source: "learned",
        })
        .onConflictDoUpdate({
          target: knowledgeBase.key,
          set: {
            content: candidate.content,
            embedding,
            category: candidate.category,
            scope: candidate.scope,
            tags: candidate.tags,
            updatedAt: new Date(),
          },
        });

      await db
        .update(knowledgeCandidates)
        .set({
          status: "approved",
          reviewedBy: reviewer,
          reviewedAt: new Date(),
        })
        .where(eq(knowledgeCandidates.id, candidate_id));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "approved",
              candidate_id,
              key: candidate.key,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "update_knowledge",
    "Update fields on an existing knowledge entry (by ID or key)",
    {
      id: z.number().optional().describe("Entry ID"),
      key: z.string().optional().describe("Entry key (alternative to ID)"),
      content: z.string().optional().describe("New content"),
      category: z.string().optional().describe("New category"),
      scope: z.string().optional().describe("New scope"),
      tags: z.array(z.string()).optional().describe("New tags"),
    },
    async ({ id, key, content, category, scope, tags }) => {
      if (!id && !key) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Provide either id or key" }),
            },
          ],
        };
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (content !== undefined) {
        updates.content = content;
        updates.embedding = await embedText(
          content,
          config.gcpProjectId,
          config.gcpLocation,
        );
      }
      if (category !== undefined) updates.category = category;
      if (scope !== undefined) updates.scope = scope;
      if (tags !== undefined) updates.tags = tags;

      const condition = id
        ? eq(knowledgeBase.id, id)
        : eq(knowledgeBase.key, key!);

      const [updated] = await db
        .update(knowledgeBase)
        .set(updates)
        .where(condition)
        .returning({
          id: knowledgeBase.id,
          key: knowledgeBase.key,
          scope: knowledgeBase.scope,
        });

      if (!updated) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Entry not found" }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ status: "updated", ...updated }),
          },
        ],
      };
    },
  );

  server.tool(
    "delete_knowledge",
    "Delete knowledge entries by ID, key, or scope",
    {
      id: z.number().optional().describe("Entry ID to delete"),
      key: z.string().optional().describe("Entry key to delete"),
      scope: z
        .string()
        .optional()
        .describe("Delete ALL entries in this scope"),
    },
    async ({ id, key, scope }) => {
      if (!id && !key && !scope) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Provide id, key, or scope",
              }),
            },
          ],
        };
      }

      let condition;
      if (id) condition = eq(knowledgeBase.id, id);
      else if (key) condition = eq(knowledgeBase.key, key);
      else condition = eq(knowledgeBase.scope, scope!);

      const deleted = await db
        .delete(knowledgeBase)
        .where(condition)
        .returning({ id: knowledgeBase.id, key: knowledgeBase.key });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              status: "deleted",
              count: deleted.length,
              entries: deleted,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "list_knowledge",
    "List knowledge entries with optional filters (no vector search)",
    {
      scope: z.string().optional().describe("Filter by scope"),
      category: z.string().optional().describe("Filter by category"),
      limit: z.number().optional().default(50).describe("Max results"),
    },
    async ({ scope, category, limit }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (scope) conditions.push(eq(knowledgeBase.scope, scope));
      if (category) conditions.push(eq(knowledgeBase.category, category));

      const results = await db
        .select({
          id: knowledgeBase.id,
          category: knowledgeBase.category,
          key: knowledgeBase.key,
          content: knowledgeBase.content,
          scope: knowledgeBase.scope,
          tags: knowledgeBase.tags,
          source: knowledgeBase.source,
          createdAt: knowledgeBase.createdAt,
          updatedAt: knowledgeBase.updatedAt,
        })
        .from(knowledgeBase)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .limit(limit ?? 50);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );

  server.tool(
    "scope_index",
    "Get a lightweight overview of knowledge by scope — category counts, keys, and last update. Use this first before pulling full content.",
    {
      scope: z
        .string()
        .optional()
        .describe("Scope to index. Omit to get stats for ALL scopes."),
    },
    async ({ scope }) => {
      if (scope) {
        // Single scope: category breakdown + all keys
        const rows = await db
          .select({
            category: knowledgeBase.category,
            key: knowledgeBase.key,
            tags: knowledgeBase.tags,
            updatedAt: knowledgeBase.updatedAt,
          })
          .from(knowledgeBase)
          .where(eq(knowledgeBase.scope, scope));

        const categories: Record<string, string[]> = {};
        let lastUpdated: Date | null = null;

        for (const row of rows) {
          if (!categories[row.category]) categories[row.category] = [];
          categories[row.category].push(row.key);
          if (!lastUpdated || (row.updatedAt && row.updatedAt > lastUpdated)) {
            lastUpdated = row.updatedAt;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  scope,
                  total_entries: rows.length,
                  categories: Object.fromEntries(
                    Object.entries(categories).map(([cat, keys]) => [
                      cat,
                      { count: keys.length, keys },
                    ]),
                  ),
                  last_updated: lastUpdated,
                },
                null,
                2,
              ),
            },
          ],
        };
      }

      // All scopes overview
      const rows = await db
        .select({
          scope: knowledgeBase.scope,
          category: knowledgeBase.category,
          updatedAt: knowledgeBase.updatedAt,
        })
        .from(knowledgeBase);

      const scopes: Record<
        string,
        { total: number; categories: Record<string, number>; lastUpdated: Date | null }
      > = {};

      for (const row of rows) {
        if (!scopes[row.scope]) {
          scopes[row.scope] = { total: 0, categories: {}, lastUpdated: null };
        }
        const s = scopes[row.scope];
        s.total++;
        s.categories[row.category] = (s.categories[row.category] || 0) + 1;
        if (!s.lastUpdated || (row.updatedAt && row.updatedAt > s.lastUpdated)) {
          s.lastUpdated = row.updatedAt;
        }
      }

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                total_entries: rows.length,
                scopes: Object.fromEntries(
                  Object.entries(scopes).map(([name, data]) => [
                    name,
                    {
                      entries: data.total,
                      categories: data.categories,
                      last_updated: data.lastUpdated,
                    },
                  ]),
                ),
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
