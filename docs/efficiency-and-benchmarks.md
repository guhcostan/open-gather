# Efficiency and benchmarks

> **Read the caveats.** Numbers on this page and in [Benchmark results](benchmark-results.md) come from a developer laptop with the load generator on the same machine. They show *where the cost goes* and *that a change helped*; they are **not** a capacity claim for a 2 vCPU / 4 GB server. Anything not run is marked **not run**.

## Design techniques (implemented)

| Area | Technique |
| --- | --- |
| Server CPU | one goroutine per office, no locks on the hot path; spatial grid so proximity checks only look at neighbouring cells; proximity evaluated at ~4 Hz, not per movement |
| Network | intent-only input; **state records instead of a position stream** ([0006](0006-state-change-records.md)); one batched frame per client per tick; integer pixel positions; no WebSocket compression; incremental enter/leave events; hand-encoded JSON without reflection |
| Slow clients | bounded queues; newest state overwrites stale ones; reliable messages preserved; disconnect on reliable overflow |
| Persistence | movement never written; last position on leave only; office chat is the only stored conversation data |
| Browser CPU/GPU | static map baked to one texture; culling to the camera; texture reuse; capped internal resolution; economy mode at 30 FPS; rendering paused in hidden tabs |
| Media | real SFU (no mesh); small rooms; audio always, video limited and ranked by active speaker; simulcast and DTX; audio-only mode; capture stops when you leave a conversation |

## Targets (to validate on the reference environments)

- Remote movement latency **p95 below 150 ms** in the documented network.
- About **60 FPS** on the reference laptop and **at least 30 FPS** in economy mode.
- No continuous, unexplained memory growth after warm-up.

## Reference environments (record with each run)

- **Server**: 2 vCPU and 4 GB RAM. CPU model, region, OS, network limits and co-located services must be recorded.
- **Client**: laptop with integrated GPU and 8 GB RAM. Model, browser and resolution must be recorded.
- Load generators run **outside** the measured machine.

## Scenarios and what has been run

| | Scenario | State |
| --- | --- | --- |
| A | 100, 300, 500, 1,000 connected, no media, spread out and concentrated | **run locally** (generator on the same host), see results |
| B | 100 present, 20 of them in five calls of four | **not run** |
| C | 100 spread across 25 calls of four | **not run** |
| D | 20-person meeting with a cap on received videos and one screen share | **not run** |
| E | simultaneous join, mass reconnect, two-hour soak | join and 500-client mass reconnect **run locally**; a shorter soak was run instead of the two-hour test; the two-hour test is **not run** |

WebSocket benchmarks do not prove video capacity. Media tests must publish and consume real or representative synthetic media. The end-to-end suite proves the media *path* works (real audio and video RTP, screen share, revocation) but says nothing about capacity.

## Tools

| Tool | Purpose |
| --- | --- |
| `server/cmd/loadgen` + `scripts/bench.sh` | WebSocket bots that walk the map, propagation-latency probes, time series; starts a fresh server per run |
| `bench/run-presence.sh` | the whole scenario A / E matrix |
| `bench/report.py`, `bench/compare.py` | Markdown tables from the JSON results |
| `bench/cost.py` | cost model with **no prices built in** |
| `e2e/` | functional browser suite (real Chrome, real LiveKit) |
| `/metrics` | Prometheus text: players, moving, tick histogram and max, frames and bytes out, records sent, skipped flushes, kicked clients, groups, media tokens, revocations and reconciliations, Go runtime |
| debug HUD (Settings) | FPS, frame time, round-trip time, world messages per second, entity counts |

Method, caveats and commands: [bench/README.md](../bench/README.md).

## Cost model (formula, no invented prices)

~~~text
monthly_cost = app_server + media_server + egress_gb * price_per_gb
             + turn + storage + backups

cost_per_connected_user = monthly_cost / average_concurrent_users
cost_per_user_in_call   = media_related_cost / average_users_in_calls
~~~

Keep **peak bandwidth** (sizing the link) separate from **monthly volume** (billing), and state the hours of use and concurrency assumed. Prices must be verified at the time of writing, which is why `bench/cost.py` takes every price as an argument. No server-price, VPS or TURN cost has been verified in this repository.
