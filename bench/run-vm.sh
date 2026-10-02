#!/usr/bin/env bash
# Presence load test (scenario A) against the production stack on a REMOTE VM, with the bots running here,
# outside the measured machine. For every bot count it gives the server a fresh database (bench mode, see
# deploy/docker-compose.bench.yml), mints an invite, samples the VM (bench/vm-sample.sh) while the bots
# walk, and keeps loadgen's JSON plus the VM samples in $OUT_DIR. The VM is put back as it was at the end.
#   TILEWORK_VM=ubuntu@1.2.3.4 TILEWORK_URL=https://office.example.com TILEWORK_SSH_KEY=~/.ssh/key bench/run-vm.sh 50 100 200
# Needs on the VM: the Compose stack in ~/tilework/deploy with METRICS_TOKEN set in .env.
set -u
cd "$(dirname "$0")/.."
VM=${TILEWORK_VM:?ssh target, e.g. ubuntu@1.2.3.4}
URL=${TILEWORK_URL:?public URL of the office}
KEY=${TILEWORK_SSH_KEY:-$HOME/.ssh/id_ed25519}
OUT=${OUT_DIR:-bench/results/vm}
DUR=${DURATION:-60}
REGION=${REGION:-distributed}
mkdir -p "$OUT"
ssh_vm() { ssh -i "$KEY" -o BatchMode=yes "$VM" "$@"; }
DC='cd ~/tilework/deploy && docker compose -p tilework -f docker-compose.yml -f docker-compose.bench.yml'
scp -q -i "$KEY" deploy/docker-compose.bench.yml "$VM:tilework/deploy/docker-compose.bench.yml"
TILEWORK_METRICS_TOKEN=$(ssh_vm "grep '^METRICS_TOKEN=' ~/tilework/deploy/.env | cut -d= -f2-")
export TILEWORK_METRICS_TOKEN
# the token reaches curl on stdin and loadgen through its environment: never as an argument (process list)
metrics_ok() { printf 'Authorization: Bearer %s\n' "$TILEWORK_METRICS_TOKEN" | curl -sf -o /dev/null -H @- "$1"; }
image() { ssh_vm "docker inspect -f '{{index .Config.Labels \"org.opencontainers.image.revision\"}} {{.Image}}' tilework-tilework-1"; }
( cd server && go build -o ../bin/loadgen ./cmd/loadgen )
restore() {
  echo "# restoring the normal stack"
  [ -n "${tun:-}" ] && kill "$tun" 2>/dev/null
  ssh_vm "cd ~/tilework/deploy && docker compose -p tilework up -d tilework >/dev/null 2>&1; $WIPE; true"
}
# the image has no shell: wipe the benchmark database with a throwaway busybox on the same volume
VOLUME=$(ssh_vm "docker inspect -f '{{range .Mounts}}{{if eq .Destination \"/data\"}}{{.Name}}{{end}}{{end}}' tilework-tilework-1")
[ -n "$VOLUME" ] || { echo 'No Tilework data volume found' >&2; exit 1; }
WIPE="docker run --rm -v $VOLUME:/data busybox rm -f /data/bench.db /data/bench.db-wal /data/bench.db-shm"
trap restore EXIT
for n in "$@"; do
  label="vm-A-$n-$REGION"
  echo "# $label"
  ssh_vm "$DC stop tilework >/dev/null 2>&1; $WIPE; $DC up -d tilework >/dev/null 2>&1"
  for i in $(seq 1 30); do curl -sf -o /dev/null "$URL/healthz" && break; sleep 1; done
  # Caddy hides /metrics from the internet: reach the container through an SSH tunnel, on a fresh local
  # port per run (a just-closed tunnel can still hold the previous one), and refuse to measure without it
  ip=$(ssh_vm "docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' tilework-tilework-1")
  [ -n "${tun:-}" ] && { kill "$tun" 2>/dev/null; wait "$tun" 2>/dev/null; }
  port=$((18100 + RANDOM % 800))
  ssh -i "$KEY" -o BatchMode=yes -o ExitOnForwardFailure=yes -N -L "$port:$ip:8080" "$VM" & tun=$!
  for i in $(seq 1 20); do metrics_ok "http://127.0.0.1:$port/metrics" && break; sleep 0.5; done
  metrics_ok "http://127.0.0.1:$port/metrics" || { echo "metrics tunnel down"; exit 1; }
  inv=$(ssh_vm "$DC exec -T tilework /app/tilework -invite member -invite-uses 1000 -invite-hours 2" | grep -o 'invite=[A-Za-z0-9_-]*' | cut -d= -f2)
  [ -n "$inv" ] || { echo "no invite"; exit 1; }
  ssh_vm "INTERVAL=2 DURATION=$((DUR + n / 15 + 25)) bash -s" < bench/vm-sample.sh > "$OUT/$label.vm.jsonl" &
  sp=$!
  ./bin/loadgen -url "$URL" -metrics-url "http://127.0.0.1:$port" -invite "$inv" -n "$n" -region "$REGION" -ramp 15 -warmup 10s -duration "${DUR}s" -label "$label" -out "$OUT/$label.json" 2> "$OUT/$label.log" > /dev/null
  kill $sp 2>/dev/null; wait $sp 2>/dev/null
  tail -n 2 "$OUT/$label.log"
  echo "$label $(image)" >> "$OUT/images.txt"   # the image that was measured
done
