FROM node:22-slim AS builder
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY services/knowledge-graph/package.json services/knowledge-graph/pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile
COPY services/knowledge-graph/tsconfig.json ./
COPY services/knowledge-graph/src/ src/
RUN pnpm run build

FROM node:22-slim
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=builder /app/dist/ dist/
COPY services/knowledge-graph/drizzle/ drizzle/
EXPOSE 8080
CMD ["node", "dist/index.js"]
