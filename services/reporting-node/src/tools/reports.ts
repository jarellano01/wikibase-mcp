import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { eq, desc, ilike, sql } from "drizzle-orm";
import type { Db } from "../db/index.js";
import { reportHistory } from "../db/schema.js";

export function registerReportTools(server: McpServer, db: Db) {
  server.tool(
    "save_report",
    "Save a completed report to history for future reference.",
    {
      question: z.string().describe("What was asked"),
      sql_queries: z.array(z.string()).describe("Queries that generated output"),
      output: z.string().describe("Result/conclusion"),
      tags: z.array(z.string()).optional().describe("Topic tags"),
    },
    async ({ question, sql_queries, output, tags }) => {
      const [inserted] = await db
        .insert(reportHistory)
        .values({
          question,
          sqlQueries: sql_queries,
          output,
          tags: tags ?? [],
        })
        .returning({ id: reportHistory.id });

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ report_id: inserted.id }),
          },
        ],
      };
    },
  );

  server.tool(
    "list_reports",
    "Search past reports by keyword (ILIKE). Returns recent reports if no search term.",
    {
      search: z.string().optional().describe("Optional keyword search"),
      limit: z.number().optional().default(20).describe("Max results"),
    },
    async ({ search, limit }) => {
      const query = db
        .select({
          id: reportHistory.id,
          question: reportHistory.question,
          output: reportHistory.output,
          tags: reportHistory.tags,
          createdAt: reportHistory.createdAt,
        })
        .from(reportHistory);

      const results = search
        ? await query
            .where(ilike(reportHistory.question, `%${search}%`))
            .orderBy(desc(reportHistory.createdAt))
            .limit(limit ?? 20)
        : await query
            .orderBy(desc(reportHistory.createdAt))
            .limit(limit ?? 20);

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );
}
