import pytest
from unittest.mock import AsyncMock
from reporting_mcp.tools.reports import _save_report_impl, _list_reports_impl


@pytest.mark.asyncio
async def test_save_report(mock_db):
    mock_db.reporting_query = AsyncMock(return_value=[{"id": 1}])
    result = await _save_report_impl("What is revenue?", ["SELECT sum(amount) FROM invoices"], "Total: $1M", mock_db)
    assert result["report_id"] == 1


@pytest.mark.asyncio
async def test_list_reports(mock_db):
    mock_db.reporting_query = AsyncMock(return_value=[
        {"id": 1, "question": "Revenue?", "created_at": "2026-03-10"},
    ])
    result = await _list_reports_impl(None, mock_db)
    assert len(result) == 1
