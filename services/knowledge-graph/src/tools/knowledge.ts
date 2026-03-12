import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sql, eq, and, inArray } from "drizzle-orm";
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
}
