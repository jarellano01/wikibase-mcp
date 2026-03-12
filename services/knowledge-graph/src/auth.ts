import type { Request, Response, NextFunction } from "express";

export function authMiddleware(apiKey: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    // Skip auth for health, MCP endpoints, and OAuth discovery probes
    if (
      req.path === "/health" ||
      req.path === "/mcp" ||
      req.path.startsWith("/.well-known/")
    ) {
      return next();
    }

    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ") || header.slice(7) !== apiKey) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}
