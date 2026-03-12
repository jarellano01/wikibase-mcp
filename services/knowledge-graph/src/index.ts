import crypto from "crypto";
import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { loadConfig, type Config } from "./config.js";
import { createDb, type Db } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { authMiddleware } from "./auth.js";
import { registerKnowledgeTools } from "./tools/knowledge.js";
import { registerSessionTools } from "./tools/sessions.js";
import { registerLearningTools } from "./tools/learning.js";

function createMcpServer(db: Db, config: Config): McpServer {
  const server = new McpServer({
    name: "Knowledge Graph MCP",
    version: "0.1.0",
  });

  registerKnowledgeTools(server, db, config);
  registerSessionTools(server, db, config);
  registerLearningTools(server, db, config);

  return server;
}

async function main() {
  const config = loadConfig();

  console.log("Running database migrations...");
  await runMigrations(config.databaseUrl);

  const db = createDb(config.databaseUrl);

  const app = express();
  app.use(express.json());
  app.use(authMiddleware(config.apiKey));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "knowledge-graph-mcp" });
  });

  // ── Streamable HTTP transport (preferred by Claude Code) ──────────
  const httpSessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: McpServer }
  >();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session — route to its transport
    if (sessionId && httpSessions.has(sessionId)) {
      const session = httpSessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
    });
    const mcpServer = createMcpServer(db, config);

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) httpSessions.delete(id);
    };

    await mcpServer.connect(transport);

    const id = transport.sessionId;
    if (id) httpSessions.set(id, { transport, server: mcpServer });

    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const session = httpSessions.get(sessionId);
    if (!session) {
      res.status(400).json({ error: "No active session" });
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
    const mcpServer = createMcpServer(db, config);
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
    console.log(`Knowledge Graph MCP running on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
