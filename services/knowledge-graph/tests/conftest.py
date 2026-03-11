import pytest
from unittest.mock import AsyncMock, MagicMock
from knowledge_graph_mcp.db import KnowledgeDB


@pytest.fixture
def mock_db():
    db = MagicMock(spec=KnowledgeDB)
    db.query = AsyncMock(return_value=[])
    db.execute = AsyncMock(return_value="INSERT 0 1")
    return db


@pytest.fixture
def mock_embed():
    """Returns a mock embed function that produces 768-dim vectors."""
    async def _embed(text, project_id, location):
        return [0.1] * 768
    return _embed
