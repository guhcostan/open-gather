#!/usr/bin/env bash
# Scenarios B, C, D against a local livekit-server with SYNTHETIC BUT REAL media (see bench/mediagen).
# Everything runs on one machine: the SFU CPU is reported in percent of ONE core, and the generator competes
# for the same cores, so treat the result as a local reference (not a 2 vCPU capacity claim).
#   B  5 rooms x 4 people, everybody with audio+video      (20 of 100 present in calls)
#   C  25 rooms x 4 people, audio+video                    (100 in calls)  and the audio-only variant
#   D  1 room x 20 people, receive cap of 6 videos, one screen share
set -u
cd "$(dirname "$0")/.."
OUT=${OUT_DIR:-bench/results/media}; mkdir -p "$OUT"
ulimit -n 20000 2>/dev/null || true
[ -f bench/mediagen/assets/video.ivf ] || bench/mediagen/make-assets.sh
( cd bench/mediagen && go build -o mediagen . )
IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
run() {
  local label=$1; shift
  local cfg="port: 17880
log_level: warn
bind_addresses: [\"\"]
prometheus_port: 16789
keys:
  devkey: secret
rtc:
  tcp_port: 17881
  udp_port: 17882
  node_ip: $IP
  use_external_ip: false"
  livekit-server --config-body "$cfg" > "$OUT/$label.sfu.log" 2>&1 &
  local pid=$!
  for i in $(seq 1 50); do curl -sf -o /dev/null http://127.0.0.1:17880/ && break; sleep 0.2; done
  ( cd bench/mediagen && ./mediagen -label "$label" -sfu-pid $pid -sfu-metrics http://127.0.0.1:16789/metrics -out "../../$OUT/$label.json" "$@" 2> "../../$OUT/$label.gen.log" >/dev/null )
  kill $pid 2>/dev/null; wait $pid 2>/dev/null
}
# Full-size C (25 rooms x 4 = 100 people) did NOT work with the generator on the same laptop (about half of the
# participants could not even connect and packet loss was ~74 %): it only runs when FULL_C=1.
run B-5x4-video -rooms 5 -per-room 4 -video -ramp 4
run C-10x4-video -rooms 10 -per-room 4 -video -ramp 2
run C-15x4-video -rooms 15 -per-room 4 -video -ramp 2
run C-25x4-audioonly -rooms 25 -per-room 4 -video=false -ramp 2
run D-20-cap6-screen -rooms 1 -per-room 20 -video -max-videos 6 -screen -ramp 4
[ "$FULL_C" = 1 ] && run C-25x4-video -rooms 25 -per-room 4 -video -ramp 4
echo done > "$OUT/.done"
