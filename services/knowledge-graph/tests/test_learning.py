import json
import pytest
from unittest.mock import AsyncMock
from knowledge_graph_mcp.tools.learning import _propose_knowledge_impl


@pytest.mark.asyncio
async def test_propose_knowledge(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{"id": 1}])
    result = await _propose_knowledge_impl(
        category="business_rules",
        key="state_derivation",
        content="State codes derive from the project number prefix.",
        scope="client:bgc",
        rationale="Discovered during revenue analysis",
        db=mock_db,
        embed_fn=mock_embed,
        project_id="proj",
        location="us-central1",
        tags=["data-model"],
        session_id=5,
    )
    assert result["candidate_id"] == 1
    assert result["status"] == "pending"


@pytest.mark.asyncio
async def test_propose_knowledge_minimal(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{"id": 2}])
    result = await _propose_knowledge_impl(
        category="context",
        key="general-insight",
        content="Some insight",
        scope="global",
        rationale="Good to know",
        db=mock_db,
        embed_fn=mock_embed,
        project_id="proj",
        location="us-central1",
    )
    assert result["candidate_id"] == 2


@pytest.mark.asyncio
async def test_propose_knowledge_with_tags(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{"id": 3}])
    result = await _propose_knowledge_impl(
        category="query_patterns",
        key="connection-pooling",
        content="Read-only replicas should use connection pooling",
        scope="global",
        rationale="Best practice",
        db=mock_db,
        embed_fn=mock_embed,
        project_id="proj",
        location="us-central1",
        tags=["database", "best-practice"],
    )
    call_args = mock_db.query.call_args
    assert ["database", "best-practice"] in call_args[0][1]
