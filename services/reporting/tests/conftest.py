import pytest
from unittest.mock import AsyncMock, MagicMock
from reporting_mcp.db import DatabaseManager


@pytest.fixture
def mock_db():
    db = MagicMock(spec=DatabaseManager)
    db.target_query = AsyncMock(return_value=[])
    db.reporting_query = AsyncMock(return_value=[])
    db.reporting_execute = AsyncMock(return_value="INSERT 0 1")
    return db
