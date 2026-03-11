"""Vertex AI text embeddings via text-embedding-005."""

import asyncio
from google.cloud import aiplatform
from vertexai.language_models import TextEmbeddingModel

MODEL_ID = "text-embedding-005"
DIMENSIONS = 768

_model = None


def _get_model(project_id: str, location: str) -> TextEmbeddingModel:
    global _model
    if _model is None:
        aiplatform.init(project=project_id, location=location)
        _model = TextEmbeddingModel.from_pretrained(MODEL_ID)
    return _model


async def embed_text(text: str, project_id: str, location: str) -> list[float]:
    """Embed a single text string. Returns 768-dimension vector."""
    model = _get_model(project_id, location)
    embeddings = await asyncio.to_thread(model.get_embeddings, [text])
    return embeddings[0].values


async def embed_batch(texts: list[str], project_id: str, location: str) -> list[list[float]]:
    """Embed multiple texts. Returns list of 768-dimension vectors."""
    model = _get_model(project_id, location)
    embeddings = await asyncio.to_thread(model.get_embeddings, texts)
    return [e.values for e in embeddings]
