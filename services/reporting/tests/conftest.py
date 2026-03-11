import pytest
from unittest.mock import AsyncMock, MagicMock
from reporting_mcp.db import DatabaseManager


@pytest.fixture
def mock_db():
    db = MagicMock(spec=DatabaseManager)
    db.target_query = AsyncMock(return_value=[])
    db.reporting_query = AsyncMock(return_value=[])
    db.reporting_execute = AsyncMock(return_value="INSERT 0 1")
    # Wire _validate_select to use the real implementation so validation tests work
    db._validate_select = DatabaseManager._validate_select.__get__(db, DatabaseManager)
    return db
