"""Application configuration from environment variables."""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    database_url: str        # Shared PG (knowledge_graph.* schema)
    api_key: str
    gcp_project_id: str
    gcp_location: str

    def __init__(self):
        self.database_url = os.environ.get("DATABASE_URL", "")
        self.api_key = os.environ.get("API_KEY", "")
        self.gcp_project_id = os.environ.get("GCP_PROJECT_ID", "")
        self.gcp_location = os.environ.get("GCP_LOCATION", "us-central1")
        missing = []
        if not self.database_url:
            missing.append("DATABASE_URL")
        if not self.api_key:
            missing.append("API_KEY")
        if not self.gcp_project_id:
            missing.append("GCP_PROJECT_ID")
        if missing:
            raise ValueError(f"Missing: {', '.join(missing)}")
