import json
import pytest
from unittest.mock import AsyncMock
from knowledge_graph_mcp.tools.knowledge import _get_knowledge_impl, _review_knowledge_impl


@pytest.mark.asyncio
async def test_get_knowledge_basic(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[
        {"id": 1, "category": "context", "key": "test", "content": "Hello", "scope": "global", "tags": []}
    ])
    result = await _get_knowledge_impl("test query", mock_db, mock_embed, "proj", "us-central1")
    assert len(result) == 1
    assert result[0]["key"] == "test"


@pytest.mark.asyncio
async def test_get_knowledge_with_scope(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[])
    result = await _get_knowledge_impl(
        "test", mock_db, mock_embed, "proj", "us-central1", scope="client:bgc"
    )
    call_args = mock_db.query.call_args
    assert "client:bgc" in call_args[0][1]


@pytest.mark.asyncio
async def test_get_knowledge_with_tags(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[])
    await _get_knowledge_impl(
        "test", mock_db, mock_embed, "proj", "us-central1", tags=["legacy-systems"]
    )
    call_args = mock_db.query.call_args
    assert ["legacy-systems"] in call_args[0][1]


@pytest.mark.asyncio
async def test_review_approve(mock_db, mock_embed):
    mock_db.query = AsyncMock(return_value=[{
        "id": 1, "category": "context", "key": "test-key",
        "content": "Test content", "scope": "global", "tags": [],
    }])
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _review_knowledge_impl(1, "approve", "admin", mock_db, mock_embed, "proj", "us-central1")
    parsed = json.loads(result)
    assert parsed["status"] == "approved"


@pytest.mark.asyncio
async def test_review_reject(mock_db, mock_embed):
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _review_knowledge_impl(1, "reject", "admin", mock_db)
    parsed = json.loads(result)
    assert parsed["status"] == "rejected"


@pytest.mark.asyncio
async def test_review_invalid_action(mock_db, mock_embed):
    result = await _review_knowledge_impl(1, "invalid", "admin", mock_db)
    parsed = json.loads(result)
    assert "error" in parsed
