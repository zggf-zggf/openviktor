FROM oven/bun:1-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock* ./
COPY apps/bot/package.json apps/bot/
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/tools/package.json packages/tools/
COPY packages/integrations/package.json packages/integrations/
RUN bun install --frozen-lockfile

FROM base AS runner
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bunx prisma generate --schema=packages/db/prisma/schema.prisma
CMD ["sh", "-c", "bunx prisma migrate deploy --schema=packages/db/prisma/schema.prisma && bun run apps/bot/src/index.ts"]
