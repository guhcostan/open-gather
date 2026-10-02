#!/usr/bin/env bash
# Presence/movement benchmark (scenario A/E): starts a fresh server (media disabled) and runs the load generator.
# usage: scripts/bench.sh <label> <bots> [loadgen flags...]
# For a valid capacity number run the generator on ANOTHER machine (-url http://server:port) and pass the
# server PID sampling yourself; when both run on one host the result is only a rough local reference.
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL=${1:?label}; N=${2:?bots}; shift 2
PORT=${TILEWORK_BENCH_PORT:-18090}
ulimit -n 20000 2>/dev/null || true
DIR=$(mktemp -d)
OUT=${OUT_DIR:-bench/results}
mkdir -p "$OUT"
TILEWORK_ENV=dev TILEWORK_ADDR=127.0.0.1:$PORT TILEWORK_DB=$DIR/bench.db TILEWORK_JOIN_RATE=100000 TILEWORK_MAX_PLAYERS=10000 \
  ${TILEWORK_BENCH_ENV:-} ./bin/tilework > $DIR/server.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null || true; wait $PID 2>/dev/null || true' EXIT
for i in $(seq 1 50); do curl -sf http://127.0.0.1:$PORT/healthz >/dev/null && break; sleep 0.1; done
./bin/loadgen -url http://127.0.0.1:$PORT -pid $PID -label "$LABEL" -n "$N" -out "$OUT/$LABEL.json" "$@"
echo "server log: $DIR/server.log" >&2
