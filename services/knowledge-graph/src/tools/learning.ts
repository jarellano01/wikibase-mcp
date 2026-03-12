import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { Db } from "../db/index.js";
import type { Config } from "../config.js";
import { embedText } from "../embeddings.js";
import { knowledgeCandidates } from "../db/schema.js";

export function registerLearningTools(
  server: McpServer,
  db: Db,
  config: Config,
) {
  server.tool(
    "propose_knowledge",
    "Propose a new knowledge entry for curator review",
    {
      category: z.string().describe("Knowledge category"),
      key: z.string().describe("Unique key for this entry"),
      content: z.string().describe("Knowledge content"),
      scope: z.string().describe("Scope identifier"),
      rationale: z
        .string()
        .describe("Why this should become permanent knowledge"),
      tags: z.array(z.string()).optional().describe("Topic tags"),
      session_id: z.number().optional().describe("Associated session ID"),
    },
    async ({ category, key, content, scope, rationale, tags, session_id }) => {
      const embedding = await embedText(
        content,
        config.gcpProjectId,
        config.gcpLocation,
      );

      const [candidate] = await db
        .insert(knowledgeCandidates)
        .values({
          category,
          key,
          content,
          embedding,
          rationale,
          scope,
          tags: tags ?? [],
          sessionId: session_id,
        })
        .returning({ id: knowledgeCandidates.id });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              candidate_id: candidate.id,
              status: "pending",
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "list_candidates",
    "List knowledge candidates with optional status filter",
    {
      status: z
        .enum(["pending", "approved", "rejected"])
        .optional()
        .default("pending")
        .describe("Filter by status (default: pending)"),
      scope: z.string().optional().describe("Filter by scope"),
      limit: z.number().optional().default(50).describe("Max results"),
    },
    async ({ status, scope, limit }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (status) conditions.push(eq(knowledgeCandidates.status, status));
      if (scope) conditions.push(eq(knowledgeCandidates.scope, scope));

      const results = await db
        .select({
          id: knowledgeCandidates.id,
          category: knowledgeCandidates.category,
          key: knowledgeCandidates.key,
          content: knowledgeCandidates.content,
          rationale: knowledgeCandidates.rationale,
          scope: knowledgeCandidates.scope,
          tags: knowledgeCandidates.tags,
          status: knowledgeCandidates.status,
          createdAt: knowledgeCandidates.createdAt,
        })
        .from(knowledgeCandidates)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(knowledgeCandidates.createdAt))
        .limit(limit ?? 50);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );
}
