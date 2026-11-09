# Background worker image. Build from the repository root:
#   docker build -f apps/worker/Dockerfile -t northstar-worker .
FROM node:22-alpine
RUN corepack enable
WORKDIR /app

# Install dependencies for the worker and the shared package only (layer cached on manifests).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter "@ai-agent/worker..."

COPY packages/shared packages/shared
COPY apps/worker apps/worker

WORKDIR /app/apps/worker
ENV NODE_ENV=production
# The worker runs TypeScript directly with tsx; configuration comes from the
# environment (see .env.example) and is validated on startup.
USER node
CMD ["pnpm", "start"]
