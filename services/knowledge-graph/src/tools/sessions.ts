import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { sql, eq, and, desc } from "drizzle-orm";
import type { Db } from "../db/index.js";
import type { Config } from "../config.js";
import { embedText } from "../embeddings.js";
import { sessions, sessionEntries } from "../db/schema.js";

export function registerSessionTools(
  server: McpServer,
  db: Db,
  config: Config,
) {
  server.tool(
    "start_session",
    "Start a new exploration session",
    {
      title: z.string().describe("Session title"),
      scope: z
        .string()
        .optional()
        .default("global")
        .describe("Scope identifier"),
      user_name: z.string().optional().describe("User name"),
    },
    async ({ title, scope, user_name }) => {
      const [session] = await db
        .insert(sessions)
        .values({ title, scope: scope ?? "global", userName: user_name })
        .returning({ id: sessions.id, scope: sessions.scope });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              session_id: session.id,
              scope: session.scope,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "add_context",
    "Add a context entry to an exploration session",
    {
      session_id: z.number().describe("Session ID"),
      entry_type: z
        .string()
        .describe("Type: question, observation, code, reference, note"),
      content: z.string().describe("Entry content"),
      metadata: z.record(z.any()).optional().describe("Additional metadata"),
    },
    async ({ session_id, entry_type, content, metadata }) => {
      const [maxSeq] = await db
        .select({
          max: sql<number>`COALESCE(MAX(${sessionEntries.sequence}), 0)`,
        })
        .from(sessionEntries)
        .where(eq(sessionEntries.sessionId, session_id));

      const sequence = (maxSeq?.max ?? 0) + 1;

      const embedding = await embedText(
        content,
        config.gcpProjectId,
        config.gcpLocation,
      );

      const [entry] = await db
        .insert(sessionEntries)
        .values({
          sessionId: session_id,
          sequence,
          entryType: entry_type,
          content,
          embedding,
          metadata: metadata ?? {},
        })
        .returning({
          id: sessionEntries.id,
          sequence: sessionEntries.sequence,
        });

      await db
        .update(sessions)
        .set({ updatedAt: new Date() })
        .where(eq(sessions.id, session_id));

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              entry_id: entry.id,
              sequence: entry.sequence,
            }),
          },
        ],
      };
    },
  );

  server.tool(
    "get_session",
    "Get a session with all its context entries",
    {
      session_id: z.number().describe("Session ID"),
    },
    async ({ session_id }) => {
      const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, session_id));

      if (!session) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: "Session not found" }),
            },
          ],
        };
      }

      const entries = await db
        .select({
          id: sessionEntries.id,
          sequence: sessionEntries.sequence,
          entryType: sessionEntries.entryType,
          content: sessionEntries.content,
          metadata: sessionEntries.metadata,
          createdAt: sessionEntries.createdAt,
        })
        .from(sessionEntries)
        .where(eq(sessionEntries.sessionId, session_id))
        .orderBy(sessionEntries.sequence);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ session, entries }, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "list_sessions",
    "List exploration sessions with optional filters",
    {
      scope: z.string().optional().describe("Filter by scope"),
      status: z.string().optional().describe("Filter by status"),
      limit: z.number().optional().default(20).describe("Max results"),
    },
    async ({ scope, status, limit }) => {
      const conditions: ReturnType<typeof eq>[] = [];
      if (scope) conditions.push(eq(sessions.scope, scope));
      if (status) conditions.push(eq(sessions.status, status));

      const results = await db
        .select({
          id: sessions.id,
          title: sessions.title,
          scope: sessions.scope,
          status: sessions.status,
          userName: sessions.userName,
          createdAt: sessions.createdAt,
          updatedAt: sessions.updatedAt,
          entryCount:
            sql<number>`(SELECT COUNT(*) FROM knowledge_graph.session_entries WHERE session_id = ${sessions.id})`,
        })
        .from(sessions)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(sessions.updatedAt))
        .limit(limit ?? 20);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(results, null, 2) },
        ],
      };
    },
  );
}
