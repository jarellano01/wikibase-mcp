import pytest
from knowledge_graph_mcp.config import Settings


def test_settings_loads(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://shared")
    monkeypatch.setenv("API_KEY", "test")
    monkeypatch.setenv("GCP_PROJECT_ID", "my-project")
    s = Settings()
    assert s.database_url == "postgresql://shared"
    assert s.gcp_location == "us-central1"  # default


def test_settings_missing_raises(monkeypatch):
    for k in ["DATABASE_URL", "API_KEY", "GCP_PROJECT_ID"]:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ValueError):
        Settings()
