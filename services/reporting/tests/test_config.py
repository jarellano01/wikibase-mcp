import pytest
from reporting_mcp.config import Settings


def test_settings_loads(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql://shared")
    monkeypatch.setenv("TARGET_DATABASE_URL", "postgresql://target")
    monkeypatch.setenv("API_KEY", "test")
    s = Settings()
    assert s.database_url == "postgresql://shared"
    assert s.target_database_url == "postgresql://target"


def test_settings_missing_raises(monkeypatch):
    for k in ["DATABASE_URL", "TARGET_DATABASE_URL", "API_KEY"]:
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(ValueError):
        Settings()
