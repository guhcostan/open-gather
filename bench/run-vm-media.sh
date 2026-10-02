#!/usr/bin/env bash
# Media load test (scenarios B/C/D) against the LiveKit SFU of a REMOTE production stack, with the synthetic
# participants (bench/mediagen: real Opus + VP8 from encoded files) running here, outside the measured VM.
# Rooms are named mg-<label>-r<N>, outside the office prefix, so the app's media reconciler leaves them alone.
# Each scenario samples the VM (bench/vm-sample.sh). The API key and secret are read from the VM's .env over
# SSH and handed to mediagen through its environment, never as arguments (those show in the process list).
#   TILEWORK_VM=ubuntu@1.2.3.4 TILEWORK_LK_URL=https://rtc.example.com TILEWORK_SSH_KEY=~/.ssh/key bench/run-vm-media.sh "B-2x4 -rooms 2 -per-room 4"
set -u
cd "$(dirname "$0")/.."
VM=${TILEWORK_VM:?ssh target}
LK=${TILEWORK_LK_URL:?public LiveKit URL, e.g. https://rtc.example.com}
KEY=${TILEWORK_SSH_KEY:-$HOME/.ssh/id_ed25519}
OUT=${OUT_DIR:-bench/results/vm-media}
DUR=${DURATION:-45}
mkdir -p "$OUT"
OUT=$(cd "$OUT" && pwd)   # mediagen runs from its own directory
ssh_vm() { ssh -i "$KEY" -o BatchMode=yes "$VM" "$@"; }
LIVEKIT_API_KEY=$(ssh_vm "grep '^LIVEKIT_API_KEY=' ~/tilework/deploy/.env | cut -d= -f2-")
LIVEKIT_API_SECRET=$(ssh_vm "grep '^LIVEKIT_API_SECRET=' ~/tilework/deploy/.env | cut -d= -f2-")
export LIVEKIT_API_KEY LIVEKIT_API_SECRET
ssh_vm "docker inspect -f '{{.Name}} {{index .Config.Labels \"org.opencontainers.image.revision\"}} {{.Image}}' tilework-tilework-1 tilework-livekit-1" > "$OUT/images.txt"
[ -f bench/mediagen/assets/video.ivf ] || bench/mediagen/make-assets.sh
( cd bench/mediagen && go build -o mediagen . )
for spec in "$@"; do
  label="vm-${spec%% *}"
  args=${spec#* }
  echo "# $label ($args)"
  ssh_vm "INTERVAL=2 DURATION=$((DUR + 60)) bash -s" < bench/vm-sample.sh > "$OUT/$label.vm.jsonl" &
  sp=$!
  # shellcheck disable=SC2086
  ( cd bench/mediagen && ./mediagen -url "$LK" -label "$label" -duration "${DUR}s" -out "$OUT/$label.json" $args 2> "$OUT/$label.gen.log" >/dev/null )
  wait $sp 2>/dev/null
  python3 - "$OUT/$label.json" <<'EOF'
import json, sys
r = json.load(open(sys.argv[1]))
print(f"  connected {r['Connected']}/{r['Participants']}  loss {r['LossPct']:.2f} %  received {r['ReceivedMbpsTotal']:.1f} Mbit/s  stalls {r['Stalls500ms']}")
EOF
  sleep 5
done
