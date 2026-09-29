# Benchmarks

Everything here is reproducible from this repository. Results are kept in [docs/benchmark-results.md](../docs/benchmark-results.md) with the machine, the exact command and the evidence class of every number:

- **MEASURED** — produced by the commands below on the recorded machine.
- **ESTIMATE** — derived from a measurement with a stated assumption.
- **NOT RUN** — no evidence yet. Never read as "works".

## What each tool can and cannot prove

| Tool | Proves | Does not prove |
|---|---|---|
| `server/cmd/loadgen` (WebSocket bots) | presence and movement fan-out cost, tick time, propagation latency, reconnect-storm behaviour | audio/video capacity (bots publish no media) |
| `e2e/` (real Chrome + fake camera/mic + real LiveKit) | functional behaviour of conversations, rooms, revocation, reconnection | capacity |
| LiveKit load test (`lk load-test`) | SFU cost for a given topology with synthetic media | anything about the app server |

A WebSocket benchmark says **nothing** about video. Media scenarios must use real or representative synthetic media, including TURN.

## Run scenario A/E (presence, no media)

```sh
go build -o bin/opengather ./server/cmd/opengather && go build -o bin/loadgen ./server/cmd/loadgen
bench/environment.sh                      # record the machine
scripts/bench.sh A-300-distributed 300 -region distributed -duration 60s
scripts/bench.sh A-300-concentrated 300 -region concentrated -duration 60s
scripts/bench.sh E-storm-500 500 -storm   # everyone drops and reconnects at once
bench/run-presence.sh                     # the whole matrix (100/300/500/1000 x distributed/concentrated + E + grouping cost)
bench/report.py                           # Markdown table from bench/results/*.json
```

`scripts/bench.sh` starts a **fresh** server (media disabled, temporary database) so runs never influence each other. Flags of `loadgen`: `-moving` (fraction of time walking), `-region distributed|concentrated`, `-consent` (bots opt in, enabling the proximity-grouping work without real media), `-probes`, `-storm`.

### Valid capacity numbers need a separate generator machine

`scripts/bench.sh` runs generator and server on the same host: the bots compete for CPU with the server, so results are a **local reference** only. For a capacity claim run the server on the reference host (2 vCPU / 4 GB), run `loadgen -url https://... -pid <server pid>` from another machine in the same region, and record both machines.

### How latency is measured

Probe pairs live in one process (one clock): the *mover* changes direction and stamps the time; the *observer* stamps the moment the server's world frame shows that entity with the new moving flag. The value is the full path *client send -> server tick -> flush -> client parse*, including the generator's own scheduling delay. With a 15 Hz tick the floor is ~0 and the worst case ~67 ms before network time, so a median near 33 ms is what the design predicts.

### Tick statistics

Tick time comes from a Prometheus histogram with buckets 0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50 ms. Reported percentiles are the **upper bound of the bucket** that contains them (coarse); the mean and max are exact.

## Media scenarios (B, C, D)

See docs/benchmark-results.md: they are only reported when they were actually executed, with the topology and the SFU host limits.
