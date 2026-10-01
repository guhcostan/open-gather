#!/usr/bin/env python3
"""Markdown table for benchmarks run against a remote VM (bench/run-vm.sh, bench/run-vm-media.sh).

Each run left <label>.json (loadgen or mediagen report) and <label>.vm.jsonl (bench/vm-sample.sh). Only VM
samples inside the run's measurement window count. Host CPU is the share of ALL vCPUs that was busy
(steal is reported apart: time the hypervisor gave to other tenants). Docker's per-container CPU leaves
stolen time out of its denominator, so on a throttled VM its absolute values are inflated (above 100 %
per vCPU); the table only uses it as a ratio between the app and Caddy. Negative report values are
loadgen's "no value" marker and print as n/a.
usage: bench/vm_report.py bench/results/vm-oracle-micro
"""
import glob, json, os, sys

def stats(xs):
    xs = [x for x in xs if x is not None]
    if not xs:
        return None, None
    return sum(xs) / len(xs), max(xs)

def window(samples, start, end):
    # a sample covers the interval that ends at t; keep those that end inside the window
    return [s for s in samples if start + 1 <= s["t"] <= end + 1]

def fmt(v, d=1):
    return "n/a" if v is None or v < 0 else f"{v:.{d}f}"

def share(a, b):
    return None if a is None or b is None or a + b <= 0 else 100 * a / (a + b)

def host(samples, ctr):
    cpu = stats([s["cpu"] for s in samples]); steal = stats([s["steal"] for s in samples])
    tx = stats([s["tx_mbps"] for s in samples]); rx = stats([s["rx_mbps"] for s in samples])
    c = stats([s["ctr"].get(ctr, {}).get("cpu") for s in samples])
    m = stats([s["ctr"].get(ctr, {}).get("mem_mb") for s in samples])
    mem = min((s["mem_avail_mb"] for s in samples), default=None)
    return cpu, steal, tx, rx, c, m, mem

def main(d):
    rows_a, rows_m = [], []
    for f in sorted(glob.glob(os.path.join(d, "*.json"))):
        label = os.path.basename(f)[:-5]
        vmf = os.path.join(d, label + ".vm.jsonl")
        if not os.path.exists(vmf):
            continue
        r = json.load(open(f))
        samples = []
        for l in open(vmf):
            try:
                samples.append(json.loads(l))
            except ValueError:
                pass  # a partial line (sampler killed mid-write, or an older sampler's "--" from docker)
        if "Bots" in r:  # loadgen
            w = window(samples, r["WindowStart"], r["WindowEnd"])
            cpu, steal, tx, rx, c, m, mem = host(w, "opengather-opengather-1")
            caddy = stats([s["ctr"].get("opengather-caddy-1", {}).get("cpu") for s in w])
            rows_a.append((r["Bots"], f"| {label} | {r['Joined']}/{r['Failed']} | {fmt(cpu[0])} / {fmt(cpu[1])} | {fmt(steal[0])} | "
                f"{fmt(share(c[0], caddy[0]), 0)} / {fmt(share(caddy[0], c[0]), 0)} | {fmt(m[1], 0)} | {fmt(mem, 0)} | {r['TickMeanMs']:.2f} | {r['TickMaxMs']:.1f} | "
                f"{fmt(tx[0], 2)} | {r['ServerKBPerSec'] / max(r['Joined'], 1):.2f} | {r['LatStartP50']:.0f} / {r['LatStartP95']:.0f} / {r['LatStartP99']:.0f} | "
                f"{int(r.get('Kicked', 0))} | {len(w)} |"))
        elif "Participants" in r:  # mediagen (see bench/mediagen)
            w = window(samples, r["WindowStart"], r["WindowEnd"])
            cpu, steal, tx, rx, c, m, mem = host(w, "opengather-livekit-1")
            rows_m.append((r["Participants"], f"| {label} | {r['Connected']}/{r['Participants']} | {r['SubscribedAudio']} / {r['SubscribedVideo']} / {r['SubscribedScr']} | "
                f"{fmt(cpu[0])} / {fmt(cpu[1])} | {fmt(steal[0])} | "
                f"{fmt(m[1], 0)} | {fmt(mem, 0)} | {fmt(rx[0], 1)} / {fmt(tx[0], 1)} | {r['ReceivedMbpsTotal']:.1f} | {r['LossPct']:.2f} | "
                f"{fmt(r['AudioJitterMsP95'])} / {fmt(r['VideoJitterMsP95'])} | {r['Stalls500ms']} | {len(w)} |"))
    if rows_a:
        print("| Run | Joined/failed | Host CPU avg/max % (all vCPUs) | Steal avg % | App / Caddy share of their CPU % | App mem max MB | Host mem available min MB | Tick mean ms | Tick max ms | VM egress Mbit/s | KB/s per client | Move latency p50/p95/p99 ms (internet) | Kicked | VM samples |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for _, row in sorted(rows_a):
            print(row)
    if rows_m:
        print()
        print("| Run | Connected | Subscribed audio / video / screen | Host CPU avg/max % (all vCPUs) | Steal avg % | SFU mem max MB | Host mem available min MB | VM in / out Mbit/s | Received by participants Mbit/s | Loss % | Jitter p95 ms (audio / video) | Stalls > 500 ms | VM samples |")
        print("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
        for _, row in sorted(rows_m):
            print(row)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "bench/results/vm")
