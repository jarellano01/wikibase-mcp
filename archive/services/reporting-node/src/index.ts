import crypto from "crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { createDb, createRawClient, type Db, type RawClient } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { authMiddleware } from "./auth.js";
import { registerQueryTools } from "./tools/query.js";
import { registerAnalysisTools } from "./tools/analysis.js";
import { registerUploadTools } from "./tools/upload.js";
import { registerReportTools } from "./tools/reports.js";

function createMcpServer(
  db: Db,
  targetClient: RawClient,
  reportingClient: RawClient,
  config: Config,
): McpServer {
  const server = new McpServer({
    name: "Reporting MCP",
    version: "0.2.0",
  });

  registerQueryTools(server, targetClient);
  registerAnalysisTools(server, config);
  registerUploadTools(server, reportingClient);
  registerReportTools(server, db);

  return server;
}

async function main() {
  const config = loadConfig();

  console.log("Running database migrations...");
  await runMigrations(config.databaseUrl);

  const db = createDb(config.databaseUrl);
  const targetClient = createRawClient(config.targetDatabaseUrl, { max: 3 });
  const reportingClient = createRawClient(config.databaseUrl, { max: 3 });

  // Set default search_path for reporting client
  await reportingClient`SET search_path TO reporting, public`;

  const app = express();
  app.use(express.json());
  app.use(authMiddleware(config.apiKey));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "reporting-mcp" });
  });

  // ── Streamable HTTP transport (preferred by Claude Code) ──────────
  const httpSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && httpSessions.has(sessionId)) {
      const session = httpSessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    if (sessionId) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session expired" },
        id: null,
      });
      return;
    }

    const newSessionId = crypto.randomUUID();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => newSessionId,
    });
    const mcpServer = createMcpServer(db, targetClient, reportingClient, config);

    transport.onclose = () => {
      httpSessions.delete(newSessionId);
    };

    await mcpServer.connect(transport);
    httpSessions.set(newSessionId, { transport, server: mcpServer });
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const session = httpSessions.get(sessionId);
    if (!session) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Session expired" },
        id: null,
      });
      return;
    }
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const session = httpSessions.get(sessionId);
    if (session) {
      await session.transport.close();
      httpSessions.delete(sessionId);
    }
    res.status(200).end();
  });

  // ── Legacy SSE transport ──────────────────────────────────────────
  const sseSessions = new Map<
    string,
    { transport: SSEServerTransport; server: McpServer }
  >();

  app.get("/sse", async (req, res) => {
    const mcpServer = createMcpServer(db, targetClient, reportingClient, config);
    const transport = new SSEServerTransport("/message", res);
    sseSessions.set(transport.sessionId, {
      transport,
      server: mcpServer,
    });

    res.on("close", () => {
      sseSessions.delete(transport.sessionId);
    });

    await mcpServer.connect(transport);
  });

  app.post("/message", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const session = sseSessions.get(sessionId);
    if (!session) {
      res.status(400).json({ error: "Unknown session" });
      return;
    }
    await session.transport.handlePostMessage(req, res);
  });

  app.listen(config.port, () => {
    console.log(`Reporting MCP running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
