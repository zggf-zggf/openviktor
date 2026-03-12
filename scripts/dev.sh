#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

export PATH="$HOME/.bun/bin:$PATH"

echo "=== OpenViktor Dev ==="
echo ""

# ─── .env ───────────────────────────────────────────────
if [ ! -f ".env" ]; then
  if [ -f "docker/.env.example" ]; then
    cp docker/.env.example .env
    echo "Created .env from docker/.env.example"
    echo ""
    echo "  Edit .env with your credentials before continuing:"
    echo "    - SLACK_BOT_TOKEN"
    echo "    - SLACK_APP_TOKEN"
    echo "    - SLACK_SIGNING_SECRET"
    echo "    - ANTHROPIC_API_KEY"
    echo ""
    exit 1
  fi
  echo "Error: .env file not found and no template available."
  exit 1
fi

# Export all vars from .env so Prisma and other tools can find them
set -a
source .env
set +a

# ─── Docker ─────────────────────────────────────────────
echo "Ensuring PostgreSQL and Redis are running..."
docker compose -f docker/docker-compose.yml up -d postgres redis 2>&1 | grep -v "already allocated" || true

for i in $(seq 1 30); do
  if pg_isready -h localhost -p 5432 -U openviktor &> /dev/null 2>&1 || \
     docker compose -f docker/docker-compose.yml exec -T postgres pg_isready -U openviktor &> /dev/null 2>&1; then
    echo "PostgreSQL ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "Error: PostgreSQL not reachable after 30s"
    exit 1
  fi
  sleep 1
done

# ─── Prisma ─────────────────────────────────────────────
echo "Generating Prisma client..."
bun run db:generate 2>&1 | tail -1

echo "Running database migrations..."
bun run db:migrate 2>&1 | tail -3

# ─── Start ──────────────────────────────────────────────
echo ""
echo "Starting bot... (Ctrl+C to stop)"
echo ""

cd apps/bot && exec bun --env-file=../../.env --watch src/index.ts
