#!/usr/bin/env bash
# Local development stack: LiveKit (dev mode) + Go server + Vite.
# NOT for production: uses the well-known LiveKit dev key pair.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .run server/data
LOG=.run

command -v livekit-server >/dev/null || { echo "livekit-server not found (brew install livekit, or use docker compose)"; exit 1; }
command -v go >/dev/null || { echo "go not found"; exit 1; }

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

livekit-server --dev --bind 127.0.0.1 > $LOG/livekit.log 2>&1 &
pids+=($!)

( cd server && go build -o ../bin/opengather ./cmd/opengather )
OG_ENV=dev OG_ADDR=127.0.0.1:8080 OG_DB="${OG_DB:-server/data/dev.db}" \
  OG_ALLOWED_ORIGINS="localhost:*,127.0.0.1:*" \
  LIVEKIT_URL=ws://127.0.0.1:7880 LIVEKIT_API_KEY=devkey LIVEKIT_API_SECRET=secret \
  ./bin/opengather > $LOG/server.log 2>&1 &
pids+=($!)

( cd web && [ -d node_modules ] || pnpm install )
( cd web && pnpm exec vite --host 127.0.0.1 > ../$LOG/vite.log 2>&1 ) &
pids+=($!)

echo "Open Gather dev stack:"
echo "  app      http://127.0.0.1:5173"
echo "  server   http://127.0.0.1:8080  (metrics: /metrics)"
echo "  livekit  ws://127.0.0.1:7880"
echo "logs in $LOG/. Ctrl-C to stop."
wait
