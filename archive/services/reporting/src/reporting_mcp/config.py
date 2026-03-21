"""Application configuration from environment variables."""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_url: str       # Shared PG (reporting.* schema)
    target_database_url: str  # Read-only target database for queries
    api_key: str

    def __init__(self):
        self.database_url = os.environ.get("DATABASE_URL", "")
        self.target_database_url = os.environ.get("TARGET_DATABASE_URL", "")
        self.api_key = os.environ.get("API_KEY", "")
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if not self.target_database_url:
            missing.append("TARGET_DATABASE_URL")
        if not self.api_key:
            missing.append("API_KEY")
        if missing:
            raise ValueError(f"Missing: {', '.join(missing)}")
