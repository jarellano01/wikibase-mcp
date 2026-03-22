import pytest
from mcp_shared.db import BaseDB


def test_basedb_init_default_schema():
    db = BaseDB("postgresql://fake", schema="reporting")
    assert db.schema == "reporting"


def test_basedb_not_connected_raises():
    db = BaseDB("postgresql://fake")
    import asyncio
    with pytest.raises(RuntimeError, match="not connected"):
        asyncio.get_event_loop().run_until_complete(db.query("SELECT 1"))
