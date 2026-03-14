#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== OpenViktor Dev (Modal backend) ==="
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

# ─── Check modal CLI ────────────────────────────────────
if ! command -v modal &>/dev/null; then
  echo "Error: modal CLI not found."
  echo "  Install: pip install modal"
  echo "  Auth:    modal setup"
  exit 1
fi

# ─── Check/create modal secret ──────────────────────────
secret_output=$(modal secret list 2>&1) || {
  echo "Error: 'modal secret list' failed:"
  echo "  $secret_output"
  exit 1
}
if ! echo "$secret_output" | grep -q "openviktor-tools"; then
  echo "Modal secret 'openviktor-tools' not found — creating from .env..."
  token=$(grep -oP '^MODAL_AUTH_TOKEN=\K.+' .env 2>/dev/null || true)
  if [ -z "$token" ]; then
    echo "Error: MODAL_AUTH_TOKEN not set in .env"
    exit 1
  fi
  modal secret create openviktor-tools "TOOL_TOKEN=$token" 2>/dev/null || true
  unset token
  echo ""
fi

# ─── Deploy Modal tools ─────────────────────────────────
echo "Deploying tools to Modal..."
DEPLOY_OUTPUT=$(modal deploy infra/modal/app.py 2>&1)
echo "$DEPLOY_OUTPUT"

ENDPOINT_URL=$(echo "$DEPLOY_OUTPUT" | grep -oP 'https://\S+\.modal\.run' | head -1)
if [ -z "$ENDPOINT_URL" ]; then
  echo "Error: could not extract Modal endpoint URL from deploy output."
  exit 1
fi
echo ""
echo "Modal endpoint: $ENDPOINT_URL"

# ─── Update .env with endpoint URL ───────────────────────
if grep -q "^MODAL_ENDPOINT_URL=" .env 2>/dev/null; then
  sed -i "s|^MODAL_ENDPOINT_URL=.*|MODAL_ENDPOINT_URL=$ENDPOINT_URL|" .env
else
  echo "MODAL_ENDPOINT_URL=$ENDPOINT_URL" >> .env
fi

if ! grep -qE '^MODAL_AUTH_TOKEN=[^[:space:]]+' .env 2>/dev/null; then
  echo ""
  echo "Error: MODAL_AUTH_TOKEN not set (or empty) in .env"
  echo "  Add it to match the TOOL_TOKEN in your modal secret."
  exit 1
fi

# ─── Start Docker (postgres + redis + bot-dev) ──────────
# docker-compose.modal.yml overrides TOOL_BACKEND=modal
echo ""
echo "Starting bot with Modal tool backend..."
echo ""

exec docker compose \
  -f docker/docker-compose.yml \
  -f docker/docker-compose.modal.yml \
  --profile dev up --build bot-dev
