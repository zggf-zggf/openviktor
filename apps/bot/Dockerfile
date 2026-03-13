FROM oven/bun:1-debian AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/tools/package.json packages/tools/
COPY packages/integrations/package.json packages/integrations/
RUN bun install --frozen-lockfile

FROM base AS dev
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run --filter @openviktor/db db:generate
CMD ["sh", "-c", "bun run --filter @openviktor/db db:migrate:deploy && bun --watch run apps/bot/src/index.ts"]

FROM base AS runner
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run --filter @openviktor/db db:generate
CMD ["sh", "-c", "bun run --filter @openviktor/db db:migrate:deploy && bun run apps/bot/src/index.ts"]
