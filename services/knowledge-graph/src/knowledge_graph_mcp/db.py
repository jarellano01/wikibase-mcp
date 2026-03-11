"""Database wrapper for knowledge graph schema."""

from mcp_shared.db import BaseDB

SCHEMA = "knowledge_graph"


class KnowledgeDB(BaseDB):
    """Knowledge graph database — operates in knowledge_graph.* schema."""

    def __init__(self, url: str):
        super().__init__(url, schema=SCHEMA)
