FROM oven/bun:1-debian AS base
WORKDIR /app

FROM base AS deps
COPY package.json bun.lock ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
COPY packages/tools/package.json packages/tools/
COPY packages/integrations/package.json packages/integrations/
RUN bun install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN bun run --filter @openviktor/db db:generate
RUN cd apps/web && bunx vite build

FROM base AS runner
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/web/node_modules apps/web/node_modules
COPY --from=deps /app/packages/db/node_modules packages/db/node_modules
COPY --from=builder /app/apps/web/dist apps/web/dist
COPY --from=builder /app/apps/web/server apps/web/server
COPY --from=builder /app/apps/web/package.json apps/web/
COPY --from=builder /app/packages/db packages/db
COPY --from=builder /app/package.json .
ENV NODE_ENV=production
WORKDIR /app/apps/web
EXPOSE 3001
CMD ["bun", "server/index.ts"]
