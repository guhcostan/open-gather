#!/usr/bin/env python3
"""Turns bench/results/*.json into a Markdown table. Usage: bench/report.py [prefix]"""
import glob, json, os, sys

sub = sys.argv[1] if len(sys.argv) > 1 else "dead-reckoning"
prefix = sys.argv[2] if len(sys.argv) > 2 else ""
rows = []
for f in sorted(glob.glob(os.path.join(os.path.dirname(__file__), "results", sub, prefix + "*.json"))):
    d = json.load(open(f))
    rows.append(d)

def n(x, p=1):
    return "-" if x is None or x != x or x < 0 else f"{x:.{p}f}"  # loadgen writes -1 for "no value"

print("| Run | Bots | Region | Joined/failed | Srv CPU avg/max % | Srv RSS MB | Tick mean ms | Tick p95 (<=) ms | Tick max ms | Srv out KB/s | KB/s per client | Msgs/s per client | Move latency p50/p95/p99 ms | Kicked/skipped |")
print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
for d in rows:
    lat = "/".join(n(d[k]) for k in ("LatStartP50", "LatStartP95", "LatStartP99"))
    print(f"| {d['Label']} | {d['Bots']} | {d['Region']} | {d['Joined']}/{d['Failed']} | {n(d['CPUAvg'])}/{n(d['CPUMax'])} | {n(d['RSSMax'],0)} | {n(d['TickMeanMs'],2)} | {n(d['TickP95ms'],0)} | {n(d['TickMaxMs'])} | {n(d['ServerKBPerSec'],0)} | {n(d['ClientKBInPerBot'])} | {n(d['ClientMsgsInPerBot'],0)} | {lat} | {int(d['Kicked'])}/{int(d['Skipped'])} |")
