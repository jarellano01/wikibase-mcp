import json
import pytest
from unittest.mock import AsyncMock
from knowledge_graph_mcp.tools.sessions import (
    _start_session_impl,
    _add_context_impl,
    _get_session_impl,
    _list_sessions_impl,
)


@pytest.mark.asyncio
async def test_start_session(mock_db):
    mock_db.query = AsyncMock(return_value=[{"id": 1}])
    result = await _start_session_impl("Review dbt framework", "client:bgc", mock_db, user_name="jon")
    assert result["session_id"] == 1
    assert result["scope"] == "client:bgc"


@pytest.mark.asyncio
async def test_add_context(mock_db, mock_embed):
    mock_db.query = AsyncMock(side_effect=[
        [{"max_seq": 2}],
        [{"id": 5}],
    ])
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _add_context_impl(1, "observation", "Merge keys are wrong", mock_db, mock_embed, "proj", "us-central1")
    assert result["sequence"] == 3


@pytest.mark.asyncio
async def test_add_context_first_entry(mock_db, mock_embed):
    mock_db.query = AsyncMock(side_effect=[
        [{"max_seq": None}],
        [{"id": 1}],
    ])
    mock_db.execute = AsyncMock(return_value="UPDATE 1")
    result = await _add_context_impl(1, "question", "What is this?", mock_db, mock_embed, "proj", "us-central1")
    assert result["sequence"] == 1


@pytest.mark.asyncio
async def test_get_session(mock_db):
    mock_db.query = AsyncMock(side_effect=[
        [{"id": 1, "title": "Test", "scope": "global", "status": "active", "user_name": "jon", "created_at": "2026-03-10", "updated_at": "2026-03-10"}],
        [{"id": 1, "sequence": 1, "entry_type": "question", "content": "Hello", "metadata": {}, "created_at": "2026-03-10"}],
    ])
    result = await _get_session_impl(1, mock_db)
    assert result["session"]["title"] == "Test"
    assert len(result["entries"]) == 1


@pytest.mark.asyncio
async def test_list_sessions(mock_db):
    mock_db.query = AsyncMock(return_value=[
        {"id": 1, "title": "Test", "scope": "global", "status": "active", "entry_count": 3, "created_at": "2026-03-10", "updated_at": "2026-03-10"},
    ])
    result = await _list_sessions_impl(mock_db)
    assert len(result) == 1
