# ── Build stage ──────────────────────────────────────────────
FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

COPY services/reporting-node/package.json services/reporting-node/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

COPY services/reporting-node/tsconfig.json ./
COPY services/reporting-node/src/ src/
RUN pnpm run build

# ── Runtime stage ────────────────────────────────────────────
FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install Python + data science stack for run_analysis subprocess
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-venv libpq-dev \
  && python3 -m venv /opt/pyenv \
  && /opt/pyenv/bin/pip install --no-cache-dir \
    pandas numpy scikit-learn matplotlib sqlalchemy psycopg2-binary openpyxl \
  && apt-get purge -y python3-pip \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

# Make python3 from venv available as "python3" on PATH
ENV PATH="/opt/pyenv/bin:$PATH"

WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist/ dist/
COPY services/reporting-node/drizzle/ drizzle/

EXPOSE 8080
CMD ["node", "dist/index.js"]
