FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc && rm -rf /var/lib/apt/lists/*

# Copy shared package
COPY packages/shared/ /packages/shared/

# Copy service + Alembic
COPY services/knowledge-graph/pyproject.toml .
COPY services/knowledge-graph/src/ src/
COPY services/knowledge-graph/alembic.ini .
COPY services/knowledge-graph/alembic/ alembic/

# Install shared then service
RUN pip install --no-cache-dir /packages/shared/ && pip install --no-cache-dir .

EXPOSE 8080
CMD ["python", "-m", "knowledge_graph_mcp"]
