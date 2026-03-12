import pytest
from unittest.mock import AsyncMock
from reporting_mcp.tools.query import _run_query_impl


@pytest.mark.asyncio
async def test_run_query_returns_results(mock_db):
    mock_db.target_query = AsyncMock(return_value=[{"state": "AZ", "count": 42}])
    result = await _run_query_impl("SELECT 1", mock_db)
    assert result["row_count"] == 1


@pytest.mark.asyncio
async def test_run_query_rejects_non_select(mock_db):
    result = await _run_query_impl("DELETE FROM users", mock_db)
    assert "error" in result


@pytest.mark.asyncio
async def test_run_query_enforces_row_limit(mock_db):
    mock_db.target_query = AsyncMock(return_value=[{"i": i} for i in range(10001)])
    result = await _run_query_impl("SELECT * FROM big", mock_db)
    assert result["row_count"] == 10000
    assert result["truncated"] is True
