# Build stage: full workspace with dev dependencies, so tsc can run.
FROM node:22-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# Manifests first, so a dependency install is cached across source edits.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/config/package.json packages/config/
COPY packages/store/package.json packages/store/
COPY packages/ingest/package.json packages/ingest/
COPY packages/analytics/package.json packages/analytics/
COPY apps/api/package.json apps/api/
COPY apps/cli/package.json apps/cli/
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Drop dev dependencies once the compiled output exists.
RUN pnpm prune --prod

# Runtime stage: no compiler, no dev dependencies, no source needed to run.
FROM node:22-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

COPY --from=build --chown=node:node /app /app

# The lake is a mounted volume, so snapshots survive a container replacement.
ENV FPL_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# Binding to loopback would make the service unreachable from outside the
# container, so the container default differs from the local default.
ENV HOST=0.0.0.0
ENV PORT=3000
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/server.js"]
