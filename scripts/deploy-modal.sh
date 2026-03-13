#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "=== OpenViktor Modal Deploy ==="
echo ""

# ─── Check modal CLI ────────────────────────────────────
if ! command -v modal &>/dev/null; then
  echo "Error: modal CLI not found."
  echo "  Install: pip install modal"
  echo "  Auth:    modal setup"
  exit 1
fi

# ─── Check secret exists ────────────────────────────────
secret_output=$(modal secret list 2>&1) || {
  echo "Error: 'modal secret list' failed:"
  echo "  $secret_output"
  exit 1
}
if ! echo "$secret_output" | grep -q "openviktor-tools"; then
  echo "Modal secret 'openviktor-tools' not found."
  echo ""
  read -rsp "Enter a TOOL_TOKEN for authenticating requests: " token
  echo ""
  if [ -z "$token" ]; then
    echo "Error: token cannot be empty."
    exit 1
  fi
  modal secret create openviktor-tools "TOOL_TOKEN=$token"
  unset token
  echo ""
fi

# ─── Deploy ──────────────────────────────────────────────
echo "Deploying to Modal..."
echo ""
modal deploy infra/modal/app.py

echo ""
echo "=== Deployment complete ==="
echo ""
echo "To use Modal as your tool backend, set in .env:"
echo "  TOOL_BACKEND=modal"
echo "  MODAL_ENDPOINT_URL=<endpoint URL printed above>"
echo "  MODAL_AUTH_TOKEN=<the TOOL_TOKEN you set in the modal secret>"
