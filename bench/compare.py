#!/usr/bin/env python3
"""Side-by-side table: baseline (bench/results/baseline-*) vs current (bench/results/*.json)."""
import glob, json, os, sys

here = os.path.join(os.path.dirname(__file__), "results")
base_dir = sys.argv[1] if len(sys.argv) > 1 else "baseline-json-15hz"
cur_dir = sys.argv[2] if len(sys.argv) > 2 else "dead-reckoning"

def load(d):
    return {os.path.basename(f)[:-5]: json.load(open(f)) for f in glob.glob(os.path.join(d, "*.json"))}

base, cur = load(os.path.join(here, base_dir)), load(os.path.join(here, cur_dir))

def f(x, p=1):
    return "-" if x is None or x != x else f"{x:.{p}f}"

print("| Run | Srv out KB/s (base -> now) | Tick mean ms | Tick max ms | Srv CPU avg % | Records/s per client | Move latency p50/p95 ms (now) |")
print("|---|---|---|---|---|---|---|")
for k in sorted(cur, key=lambda s: (s.split("-")[0], len(s), s)):
    b, c = base.get(k), cur[k]
    if b is None:
        continue
    per_b = b["PosPerSec"] / max(1, b["Joined"])
    per_c = c["PosPerSec"] / max(1, c["Joined"])
    print(f"| {k} | {f(b['ServerKBPerSec'],0)} -> {f(c['ServerKBPerSec'],0)} | {f(b['TickMeanMs'],2)} -> {f(c['TickMeanMs'],2)} | {f(b['TickMaxMs'])} -> {f(c['TickMaxMs'])} | {f(b['CPUAvg'])} -> {f(c['CPUAvg'])} | {f(per_b,0)} -> {f(per_c,0)} | {f(c['LatStartP50'])}/{f(c['LatStartP95'])} |")
