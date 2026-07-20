#!/usr/bin/env bash
# Upload the Worker's secrets to Cloudflare, read from the repo-root .env.
# Run once after `wrangler login`, before/after `wrangler deploy`.
#
#   cd worker && ./scripts/put-secrets.sh
#
# Values are piped to `wrangler secret put` via stdin — they are never written to
# disk and never printed.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="../.env"
[ -f "$ENV_FILE" ] || { echo "error: $ENV_FILE not found" >&2; exit 1; }

SECRETS="SF_TOKEN_URL SF_CLIENT_ID SF_CLIENT_SECRET DEEPSEEK_API_KEY OPENROUTER_API_KEY GEMINI_API_KEY"

for k in $SECRETS; do
  v=$(grep -E "^$k=" "$ENV_FILE" | head -1 | cut -d= -f2-)
  v="${v%\"}"; v="${v#\"}"; v="${v%\'}"; v="${v#\'}"   # strip surrounding quotes
  if [ -z "$v" ]; then
    echo "skip $k (empty in .env)"
    continue
  fi
  printf '%s' "$v" | npx wrangler secret put "$k"
done

echo "Done. Set secrets: $SECRETS"
