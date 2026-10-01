#!/usr/bin/env bash
# Host sampler for benchmarks on a remote VM. Run it ON the measured machine; it prints one JSON object
# per interval to stdout (redirect to a file), until it is killed or DURATION seconds pass:
#   ssh vm 'bash -s' < bench/vm-sample.sh > samples.jsonl          # every 2 s, 600 s
#   ssh vm 'INTERVAL=1 DURATION=120 bash -s' < bench/vm-sample.sh > samples.jsonl
# Fields: t (unix s), cpu (% of ALL vCPUs busy, steal excluded), steal (% of all vCPUs stolen by the
# hypervisor), ncpu, mem_avail_mb, swap_used_mb, rx/tx (Mbit/s on the default interface) and, when
# docker is present, per-container CPU (% of one vCPU, as docker reports it) and memory in MB.
set -u
INTERVAL=${INTERVAL:-2}
DURATION=${DURATION:-600}
IF=$(ip route show default 2>/dev/null | awk '{print $5; exit}')
ncpu=$(nproc)
read_stat() { awk '/^cpu /{print $2+$3+$4+$7+$8, $5+$6, $9}' /proc/stat; }   # busy idle steal
read_net() { awk -v i="$IF:" '$1==i{print $2, $10}' /proc/net/dev; }
read -r b0 i0 s0 < <(read_stat); read -r rx0 tx0 < <(read_net)
t0=$(date +%s.%N)
end=$(( $(date +%s) + DURATION ))
while [ "$(date +%s)" -lt "$end" ]; do
  sleep "$INTERVAL"
  read -r b1 i1 s1 < <(read_stat); read -r rx1 tx1 < <(read_net)
  t1=$(date +%s.%N); dt=$(echo "$t1 - $t0" | bc -l)   # docker stats itself takes ~1-2 s: use the real interval
  db=$((b1 - b0)); di=$((i1 - i0)); ds=$((s1 - s0)); tot=$((db + di + ds)); [ "$tot" -gt 0 ] || tot=1
  mem=$(awk '/MemAvailable/{print int($2/1024)}' /proc/meminfo)
  swap=$(awk '/SwapTotal/{t=$2} /SwapFree/{f=$2} END{print int((t-f)/1024)}' /proc/meminfo)
  ctr=""
  if command -v docker >/dev/null; then
    # containers that are starting or stopping report "--": skip them
    ctr=$(docker stats --no-stream --format '{{.Name}} {{.CPUPerc}} {{.MemUsage}}' 2>/dev/null | awk '{gsub("%","",$2); if ($2 !~ /^[0-9.]+$/) next; m=$3; u=1; if (m ~ /GiB/) u=1024; if (m ~ /KiB/) u=1/1024; gsub(/[A-Za-z]/,"",m); printf "%s\"%s\":{\"cpu\":%s,\"mem_mb\":%.1f}", (n++?",":""), $1, $2, m*u}')
  fi
  printf '{"t":%s,"ncpu":%d,"cpu":%.1f,"steal":%.1f,"mem_avail_mb":%d,"swap_used_mb":%d,"rx_mbps":%.2f,"tx_mbps":%.2f,"ctr":{%s}}\n' \
    "$(echo "$t1" | cut -c1-14)" "$ncpu" "$(echo "100*$db/$tot" | bc -l)" "$(echo "100*$ds/$tot" | bc -l)" "$mem" "$swap" \
    "$(echo "($rx1-$rx0)*8/1000000/$dt" | bc -l)" "$(echo "($tx1-$tx0)*8/1000000/$dt" | bc -l)" "$ctr"
  b0=$b1; i0=$i1; s0=$s1; rx0=$rx1; tx0=$tx1; t0=$t1
done
