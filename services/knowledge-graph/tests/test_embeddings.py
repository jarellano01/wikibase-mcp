import pytest
from unittest.mock import patch, MagicMock
from knowledge_graph_mcp.embeddings import embed_text


@pytest.mark.asyncio
async def test_embed_text_returns_768_dims():
    mock_model = MagicMock()
    mock_embedding = MagicMock()
    mock_embedding.values = [0.1] * 768
    mock_model.get_embeddings.return_value = [mock_embedding]

    with patch("knowledge_graph_mcp.embeddings._get_model", return_value=mock_model):
        result = await embed_text("test query", "my-project", "us-central1")
        assert len(result) == 768
