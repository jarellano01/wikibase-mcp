# Plan 11 — Deployment (Docker + GitHub Actions)

**Goal:** Create Dockerfiles for both services and a reusable GitHub Actions workflow for Cloud Run deployment.

**Ref:** [specs/architecture.md](../specs/architecture.md)

**Depends on:** Plans 05, 10

---

## Files to Create

- `services/reporting/Dockerfile`
- `services/knowledge-graph/Dockerfile`
- `.github/workflows/deploy-mcp-service.yml` (reusable template)
- `.github/workflows/reporting.yml` (caller)
- `.github/workflows/knowledge-graph.yml` (caller)

---

## Steps

### Dockerfiles

- [ ] **Step 1: Write reporting Dockerfile**

Build context is the repo root so it can access `packages/shared/`.

```dockerfile
# services/reporting/Dockerfile
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
```

- [ ] **Step 2: Write knowledge graph Dockerfile**

```dockerfile
# services/knowledge-graph/Dockerfile
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
```

### Reusable GitHub Actions Workflow

- [ ] **Step 3: Write reusable deployment workflow template**

```yaml
# .github/workflows/deploy-mcp-service.yml
name: Deploy MCP Service (Reusable)

on:
  workflow_call:
    inputs:
      service-name:
        required: true
        type: string
      service-path:
        required: true
        type: string
        description: "Path to the service directory, e.g. services/reporting"
      memory:
        required: false
        type: string
        default: "1Gi"
      cpu:
        required: false
        type: string
        default: "1"
      timeout:
        required: false
        type: number
        default: 300
      max-instances:
        required: false
        type: number
        default: 1
      secrets-list:
        required: false
        type: string
        default: ""
        description: "Comma-separated --set-secrets flags"
      env-vars:
        required: false
        type: string
        default: ""
        description: "Comma-separated env vars"
    secrets:
      GCP_PROJECT_ID:
        required: true
      WIF_PROVIDER:
        required: true
      WIF_SERVICE_ACCOUNT:
        required: true

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - name: Install uv
        run: pip install uv
      - name: Install dependencies
        run: uv sync
      - name: Run tests
        run: uv run pytest ${{ inputs.service-path }}/tests/ -v

  deploy:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
    env:
      PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
      SERVICE: ${{ inputs.service-name }}
      REGION: us-central1
    steps:
      - uses: actions/checkout@v4
      - uses: google-github-actions/auth@v2
        with:
          workload_identity_provider: ${{ secrets.WIF_PROVIDER }}
          service_account: ${{ secrets.WIF_SERVICE_ACCOUNT }}
      - uses: google-github-actions/setup-gcloud@v2
      - name: Configure Docker
        run: gcloud auth configure-docker
      - name: Build and push
        run: |
          docker build -f ${{ inputs.service-path }}/Dockerfile -t gcr.io/$PROJECT_ID/$SERVICE .
          docker push gcr.io/$PROJECT_ID/$SERVICE
      - name: Deploy to Cloud Run
        run: |
          DEPLOY_CMD="gcloud run deploy $SERVICE \
            --image gcr.io/$PROJECT_ID/$SERVICE \
            --region $REGION \
            --min-instances 0 \
            --max-instances ${{ inputs.max-instances }} \
            --memory ${{ inputs.memory }} \
            --cpu ${{ inputs.cpu }} \
            --timeout ${{ inputs.timeout }} \
            --concurrency 1 \
            --port 8080 \
            --allow-unauthenticated"

          if [ -n "${{ inputs.secrets-list }}" ]; then
            DEPLOY_CMD="$DEPLOY_CMD --set-secrets=${{ inputs.secrets-list }}"
          fi

          if [ -n "${{ inputs.env-vars }}" ]; then
            DEPLOY_CMD="$DEPLOY_CMD --set-env-vars=${{ inputs.env-vars }}"
          fi

          eval $DEPLOY_CMD
```

### Caller Workflows

- [ ] **Step 4: Write reporting caller workflow**

```yaml
# .github/workflows/reporting.yml
name: Deploy Reporting MCP

on:
  push:
    branches: [main]
    paths:
      - "services/reporting/**"
      - "packages/shared/**"

jobs:
  deploy:
    uses: ./.github/workflows/deploy-mcp-service.yml
    with:
      service-name: reporting-mcp
      service-path: services/reporting
      memory: 1Gi
      cpu: "1"
      timeout: 300
      max-instances: 1
      secrets-list: "DATABASE_URL=database-url:latest,TARGET_DATABASE_URL=target-database-url:latest,API_KEY=reporting-api-key:latest"
    secrets:
      GCP_PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
      WIF_PROVIDER: ${{ secrets.WIF_PROVIDER }}
      WIF_SERVICE_ACCOUNT: ${{ secrets.WIF_SERVICE_ACCOUNT }}
```

- [ ] **Step 5: Write knowledge graph caller workflow**

```yaml
# .github/workflows/knowledge-graph.yml
name: Deploy Knowledge Graph MCP

on:
  push:
    branches: [main]
    paths:
      - "services/knowledge-graph/**"
      - "packages/shared/**"

jobs:
  deploy:
    uses: ./.github/workflows/deploy-mcp-service.yml
    with:
      service-name: knowledge-graph-mcp
      service-path: services/knowledge-graph
      memory: 512Mi
      cpu: "1"
      timeout: 60
      max-instances: 1
      secrets-list: "DATABASE_URL=database-url:latest,API_KEY=kg-api-key:latest,GCP_PROJECT_ID=gcp-project-id:latest"
      env-vars: "GCP_LOCATION=us-central1"
    secrets:
      GCP_PROJECT_ID: ${{ secrets.GCP_PROJECT_ID }}
      WIF_PROVIDER: ${{ secrets.WIF_PROVIDER }}
      WIF_SERVICE_ACCOUNT: ${{ secrets.WIF_SERVICE_ACCOUNT }}
```

- [ ] **Step 6: Test Docker builds locally**

```bash
# From repo root
docker build -f services/reporting/Dockerfile -t reporting-mcp .
docker build -f services/knowledge-graph/Dockerfile -t knowledge-graph-mcp .

# Quick smoke test
docker run --rm -e DATABASE_URL=... -e TARGET_DATABASE_URL=... -e API_KEY=test -p 8080:8080 reporting-mcp
```

- [ ] **Step 7: Commit**

```bash
git add services/reporting/Dockerfile services/knowledge-graph/Dockerfile .github/workflows/
git commit -m "feat: add Dockerfiles and GitHub Actions deployment (reusable workflow + callers)"
```

---

## Deployment Checklist (Post-Implementation)

1. Create Postgres instance with `pgvector` extension (or Neon free tier)
2. Create GCP Secret Manager secrets: `database-url`, `target-database-url`, `reporting-api-key`, `kg-api-key`, `gcp-project-id`
3. Configure GitHub Secrets: `GCP_PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`
4. Push to `main` — GitHub Actions builds + deploys both services
5. Configure Claude Desktop with both MCP server URLs + API keys
6. Smoke test each service
