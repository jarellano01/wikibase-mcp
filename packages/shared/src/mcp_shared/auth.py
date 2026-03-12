"""Bearer token authentication middleware for MCP services."""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse


class AuthMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, api_key: str):
        super().__init__(app)
        self.api_key = api_key

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        # Skip auth for health, MCP/SSE endpoints, and OAuth discovery probes
        if (
            path == "/health"
            or path in ("/sse", "/message")
            or path.startswith("/.well-known/")
        ):
            return await call_next(request)
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer ") or auth[7:] != self.api_key:
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)
