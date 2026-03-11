import pytest
from unittest.mock import AsyncMock
from reporting_mcp.tools.upload import _upload_file_impl, _stage_data_impl


def test_upload_csv(tmp_path):
    f = tmp_path / "test.csv"
    f.write_text("name,age\nAlice,30\nBob,25\n")
    result = _upload_file_impl(str(f))
    assert result["headers"] == ["name", "age"]
    assert len(result["preview"]) == 2


@pytest.mark.asyncio
async def test_stage_data(mock_db):
    mock_db.reporting_execute = AsyncMock(return_value="CREATE TABLE")
    mock_db.reporting_query = AsyncMock(return_value=[{"id": 1}])
    result = await _stage_data_impl(
        {"name": "TEXT", "age": "INTEGER"}, [["Alice", 30]], "test.csv", mock_db
    )
    assert result["table_name"].startswith("staged_")
    assert result["row_count"] == 1
