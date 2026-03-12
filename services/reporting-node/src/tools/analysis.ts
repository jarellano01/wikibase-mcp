import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { execFile } from "child_process";
import { writeFile, readFile, unlink, access } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import type { Config } from "../config.js";

const PREAMBLE = `\
import os, json
try:
    import pandas as pd
    import numpy as np
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from sqlalchemy import create_engine, text
    target_engine = create_engine(os.environ['_TARGET_URL'])
    reporting_engine = create_engine(os.environ['_REPORTING_URL'])
except Exception:
    pass
`;

export function registerAnalysisTools(server: McpServer, config: Config) {
  server.tool(
    "run_analysis",
    "Execute Python with pre-configured DB connections (target_engine, reporting_engine). pandas, numpy, sklearn, matplotlib available. 60s timeout.",
    {
      code: z.string().describe("Python code to execute"),
    },
    async ({ code }) => {
      const scriptPath = path.join(tmpdir(), `mcp_analysis_${Date.now()}.py`);
      await writeFile(scriptPath, PREAMBLE + "\n" + code);

      try {
        const result = await new Promise<{
          stdout: string;
          stderr: string;
          error: string | null;
        }>((resolve) => {
          const env = {
            ...process.env,
            _TARGET_URL: config.targetDatabaseUrl,
            _REPORTING_URL: config.databaseUrl,
          };

          const child = execFile(
            "python3",
            [scriptPath],
            { env, timeout: 60_000, maxBuffer: 10 * 1024 * 1024 },
            (err, stdout, stderr) => {
              if (err && "killed" in err && err.killed) {
                resolve({
                  stdout: "",
                  stderr: "",
                  error: "Timed out after 60s",
                });
                return;
              }
              resolve({
                stdout,
                stderr,
                error: err ? stderr || err.message : null,
              });
            },
          );
        });

        // Collect any generated plot images
        const images: string[] = [];
        for (let i = 0; i < 20; i++) {
          const imgPath = `/tmp/mcp_plot_${i}.png`;
          try {
            await access(imgPath);
            const buf = await readFile(imgPath);
            images.push(buf.toString("base64"));
            await unlink(imgPath);
          } catch {
            // File doesn't exist, skip
          }
        }

        const response = { ...result, images };

        // Return images as separate image content blocks
        const content: Array<
          | { type: "text"; text: string }
          | { type: "image"; data: string; mimeType: string }
        > = [
          {
            type: "text" as const,
            text: JSON.stringify(
              { stdout: response.stdout, stderr: response.stderr, error: response.error },
            ),
          },
        ];

        for (const img of images) {
          content.push({
            type: "image" as const,
            data: img,
            mimeType: "image/png",
          });
        }

        return { content };
      } finally {
        try {
          await unlink(scriptPath);
        } catch {
          // Ignore cleanup errors
        }
      }
    },
  );
}
