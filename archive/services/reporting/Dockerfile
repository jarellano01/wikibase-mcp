FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libpq-dev gcc && rm -rf /var/lib/apt/lists/*

# Copy shared package
COPY packages/shared/ /packages/shared/

# Copy service + Alembic
COPY services/reporting/pyproject.toml .
COPY services/reporting/src/ src/
COPY services/reporting/alembic.ini .
COPY services/reporting/alembic/ alembic/

# Install shared then service
RUN pip install --no-cache-dir /packages/shared/ && pip install --no-cache-dir .

EXPOSE 8080
CMD ["python", "-m", "reporting_mcp"]
