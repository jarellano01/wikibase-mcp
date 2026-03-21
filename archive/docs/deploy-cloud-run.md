# Deploying to Google Cloud Run

This guide covers deploying the MCP services to Cloud Run using the pre-built images from GitHub Container Registry.

## Prerequisites

- [Google Cloud CLI](https://cloud.google.com/sdk/docs/install) (`gcloud`)
- A GCP project with billing enabled
- Cloud Run API enabled:
  ```bash
  gcloud services enable run.googleapis.com
  ```

## Quick Deploy

Each service image is publicly available on GHCR:

```
ghcr.io/jarellano01/reporting-mcp:latest
ghcr.io/jarellano01/knowledge-graph-mcp:latest
```

### Reporting MCP

```bash
gcloud run deploy reporting-mcp \
  --image ghcr.io/jarellano01/reporting-mcp:latest \
  --region us-central1 \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --allow-unauthenticated \
  --set-env-vars "TARGET_DATABASE_URL=postgresql://user:pass@host:5432/mydb" \
  --set-secrets "DATABASE_URL=database-url:latest,API_KEY=reporting-api-key:latest"
```

### Knowledge Graph MCP

```bash
gcloud run deploy knowledge-graph-mcp \
  --image ghcr.io/jarellano01/knowledge-graph-mcp:latest \
  --region us-central1 \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --concurrency 1 \
  --min-instances 0 \
  --max-instances 1 \
  --timeout 60 \
  --allow-unauthenticated \
  --set-env-vars "GCP_LOCATION=us-central1" \
  --set-secrets "DATABASE_URL=database-url:latest,API_KEY=kg-api-key:latest,GCP_PROJECT_ID=gcp-project-id:latest"
```

## Environment Variables

| Variable | Service | Description |
|---|---|---|
| `DATABASE_URL` | Both | Postgres connection string for service data |
| `API_KEY` | Both | API key for authenticating requests |
| `TARGET_DATABASE_URL` | Reporting | Read-only connection to the database being reported on |
| `GCP_PROJECT_ID` | Knowledge Graph | GCP project for Vertex AI embeddings |
| `GCP_LOCATION` | Knowledge Graph | GCP region for Vertex AI (e.g. `us-central1`) |

## Using Secret Manager

The examples above use `--set-secrets` which references [Secret Manager](https://cloud.google.com/secret-manager) secrets. To create them:

```bash
# Create secrets
echo -n "postgresql://user:pass@host:5432/ai_mcp" | \
  gcloud secrets create database-url --data-file=-

echo -n "your-api-key" | \
  gcloud secrets create reporting-api-key --data-file=-

# Grant the Cloud Run service account access
gcloud secrets add-iam-policy-binding database-url \
  --member="serviceAccount:PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Alternatively, pass values directly with `--set-env-vars` (not recommended for secrets):

```bash
gcloud run deploy reporting-mcp \
  --image ghcr.io/jarellano01/reporting-mcp:latest \
  --set-env-vars "DATABASE_URL=postgresql://...,API_KEY=your-key"
```

## Building from Source

If you prefer to build and push to your own registry:

```bash
# From the repo root
docker build -f services/reporting/Dockerfile -t gcr.io/YOUR_PROJECT/reporting-mcp .
docker push gcr.io/YOUR_PROJECT/reporting-mcp

docker build -f services/knowledge-graph/Dockerfile -t gcr.io/YOUR_PROJECT/knowledge-graph-mcp .
docker push gcr.io/YOUR_PROJECT/knowledge-graph-mcp
```

Then replace the image references in the deploy commands above.

## Verifying the Deployment

```bash
# Get the service URL
gcloud run services describe reporting-mcp --region us-central1 --format "value(status.url)"

# Test the health endpoint
curl $(gcloud run services describe reporting-mcp --region us-central1 --format "value(status.url)")/health
```
