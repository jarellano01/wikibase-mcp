import pytest
from starlette.testclient import TestClient
from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.responses import JSONResponse
from starlette.routing import Route
from mcp_shared.auth import AuthMiddleware


def _make_app(api_key: str):
    async def home(request):
        return JSONResponse({"ok": True})

    async def health(request):
        return JSONResponse({"status": "ok"})

    return Starlette(
        routes=[Route("/", home), Route("/health", health)],
        middleware=[Middleware(AuthMiddleware, api_key=api_key)],
    )


def test_valid_bearer_token():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/", headers={"Authorization": "Bearer test-key"})
    assert resp.status_code == 200


def test_missing_token_returns_401():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/")
    assert resp.status_code == 401


def test_wrong_token_returns_401():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


def test_health_endpoint_bypasses_auth():
    client = TestClient(_make_app("test-key"))
    resp = client.get("/health")
    assert resp.status_code == 200
