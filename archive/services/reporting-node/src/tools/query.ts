import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { RawClient } from "../db/index.js";

const MAX_ROWS = 10_000;

function validateSelect(sql: string) {
  const stripped = sql.trim().replace(/;$/, "");
  if (stripped.includes(";")) {
    throw new Error("Only a single statement is allowed");
  }
  if (!/^\s*(SELECT|WITH)\b/i.test(stripped)) {
    throw new Error("Only SELECT (or WITH ... SELECT) queries are allowed");
  }
}

export function registerQueryTools(server: McpServer, targetClient: RawClient) {
  server.tool(
    "run_query",
    "Execute read-only SQL against the target database. SELECT-only, 30s timeout, 10K row limit.",
    {
      sql: z.string().describe("SQL query (SELECT or WITH ... SELECT only)"),
    },
    async ({ sql: query }) => {
      try {
        validateSelect(query);
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ error: (e as Error).message }),
            },
          ],
        };
      }

      try {
        const rows = await targetClient.unsafe(query);
        const truncated = rows.length > MAX_ROWS;
        const result = truncated ? rows.slice(0, MAX_ROWS) : rows;

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  rows: result,
                  row_count: result.length,
                  truncated,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Query failed: ${(e as Error).message}`,
              }),
            },
          ],
        };
      }
    },
  );
}
