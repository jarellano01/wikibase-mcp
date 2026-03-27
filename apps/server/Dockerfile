FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/db/package.json packages/db/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile

# Copy source and build
COPY packages/db/ packages/db/
COPY apps/server/ apps/server/
RUN pnpm --filter @wikibase/db build && pnpm --filter @wikibase/server build

FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@10.22.0 --activate
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/db/package.json packages/db/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/db/dist/ packages/db/dist/
COPY --from=builder /app/apps/server/dist/ apps/server/dist/

EXPOSE 3001
ENV PORT=3001
CMD ["node", "apps/server/dist/index.js"]
