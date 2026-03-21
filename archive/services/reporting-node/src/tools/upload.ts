import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { readFileSync } from "fs";
import { createHash } from "crypto";
import * as XLSX from "xlsx";
import type { RawClient } from "../db/index.js";

function parseFile(filePath: string) {
  const name = filePath.split("/").pop() ?? filePath;
  const isExcel = /\.xlsx?$/i.test(name);

  if (isExcel) {
    const workbook = XLSX.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
    const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

    // Infer dtypes from first non-null values
    const dtypes: Record<string, string> = {};
    for (const h of headers) {
      const sample = rows.find((r) => r[h] != null)?.[h];
      dtypes[h] = typeof sample === "number" ? "float64" : "object";
    }

    return {
      file_name: name,
      headers,
      dtypes,
      row_count: rows.length,
      preview: rows.slice(0, 20),
      sheet_names: workbook.SheetNames,
    };
  }

  // CSV
  const workbook = XLSX.readFile(filePath, { type: "file" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet);
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];

  const dtypes: Record<string, string> = {};
  for (const h of headers) {
    const sample = rows.find((r) => r[h] != null)?.[h];
    dtypes[h] = typeof sample === "number" ? "float64" : "object";
  }

  return {
    file_name: name,
    headers,
    dtypes,
    row_count: rows.length,
    preview: rows.slice(0, 20),
  };
}

export function registerUploadTools(
  server: McpServer,
  reportingClient: RawClient,
) {
  server.tool(
    "upload_file",
    "Parse Excel/CSV file, return preview (headers, 20 rows, dtypes, sheet names).",
    {
      file_path: z.string().describe("Path to the CSV or Excel file"),
    },
    async ({ file_path }) => {
      try {
        const result = parseFile(file_path);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: `Failed to parse file: ${(e as Error).message}`,
              }),
            },
          ],
        };
      }
    },
  );

  server.tool(
    "stage_data",
    "Create a temp table from parsed file data. Expires after 24 hours.",
    {
      columns: z
        .record(z.string())
        .describe('Column definitions: {"col_name": "SQL_TYPE"}'),
      rows: z.array(z.array(z.unknown())).describe("Row data as arrays"),
      file_name: z.string().describe("Original file name"),
    },
    async ({ columns, rows, file_name }) => {
      const suffix = createHash("md5")
        .update(`${file_name}${Date.now()}`)
        .digest("hex")
        .slice(0, 8);
      const tableName = `staged_${suffix}`;

      const colEntries = Object.entries(columns);
      const colDefs = colEntries
        .map(([name, type]) => `"${name}" ${type}`)
        .join(", ");

      await reportingClient.unsafe(
        `CREATE TABLE reporting."${tableName}" (${colDefs})`,
      );

      // Insert rows
      for (const row of rows) {
        const placeholders = colEntries.map((_, i) => `$${i + 1}`).join(", ");
        const colNames = colEntries.map(([n]) => `"${n}"`).join(", ");
        await reportingClient.unsafe(
          `INSERT INTO reporting."${tableName}" (${colNames}) VALUES (${placeholders})`,
          row as (string | number | null)[],
        );
      }

      // Record in staged_uploads
      await reportingClient.unsafe(
        `INSERT INTO reporting.staged_uploads (file_name, table_name, columns, row_count) VALUES ($1, $2, $3::jsonb, $4)`,
        [file_name, tableName, JSON.stringify(columns), rows.length],
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              table_name: tableName,
              row_count: rows.length,
              columns,
            }),
          },
        ],
      };
    },
  );
}
