# Efficiency and benchmarks

> **Nothing on this page is a measured capacity claim.** It lists what the design does to save resources, the targets we want to validate, and how results will be reported.

## Design techniques (implemented)

| Area | Technique |
| --- | --- |
| Server CPU | one goroutine per office, no locks on the hot path; spatial grid so proximity checks only look at neighbouring cells; proximity evaluated at ~4 Hz, not per movement |
| Network | intent-only input; one batched frame per client per tick; integer pixel positions; no WebSocket compression; incremental enter/leave events |
| Slow clients | bounded queues; newest position overwrites stale ones; reliable messages preserved; disconnect on reliable overflow |
| Persistence | movement never written; last position on leave only |
| Browser CPU/GPU | static map baked to one texture; culling to the camera; texture reuse; capped internal resolution; economy mode at 30 FPS; rendering paused in hidden tabs |
| Media | real SFU (no mesh); small rooms; audio always, video limited and ranked by active speaker; simulcast and DTX; audio-only mode |

## Targets (to validate)

- Remote movement latency **p95 below 150 ms** in the documented network.
- About **60 FPS** on the reference laptop and **at least 30 FPS** in economy mode.
- No continuous, unexplained memory growth after warm-up.

## Reference environments (to be recorded with each run)

- **Server**: 2 vCPU and 4 GB RAM. CPU model, region, OS, network limits and co-located services must be recorded.
- **Client**: laptop with integrated GPU and 8 GB RAM. Model, browser and resolution must be recorded.
- Load generators run **outside** the measured machine.

## Scenarios

| | Scenario |
| --- | --- |
| A | 100, 300, 500 and 1,000 connected participants without media, with a stated share moving; both spread out and concentrated in one area |
| B | 100 present, 20 of them in five calls of four |
| C | 100 spread across 25 calls of four |
| D | 20-person meeting with a cap on received videos and one screen share |
| E | simultaneous join, mass reconnect and a two-hour soak test |

## What will be measured

CPU, RAM and inbound/outbound bandwidth; p50/p95/p99 movement propagation latency; tick processing time; connections, messages per second, queues and disconnects; browser FPS, frame time, memory and CPU; time to enter a conversation; bitrate, jitter, packet loss and media interruptions (including runs through TURN); reconnect behaviour and memory growth over time.

WebSocket benchmarks do not prove video capacity. Media tests must publish and consume real or representative synthetic media.

## What exists today

- The server exposes Prometheus metrics: players, moving players, tick-time histogram and max, frames and bytes out, positions sent, positions coalesced, skipped flushes, kicked clients, conversation joins/leaves, media token and revocation counters, and Go runtime stats.
- The browser has a debug HUD with FPS, frame time, round-trip time, world messages per second and entity counts.

**No load test has been run.** The scenarios above are not executed yet, and costs are not estimated.

## Cost model (formula, no invented prices)

Report cost per scenario as:

~~~text
monthly_cost = app_server + media_server + egress_gb * price_per_gb
             + turn + storage + backups

cost_per_connected_user = monthly_cost / average_concurrent_users
cost_per_user_in_call   = media_related_cost / average_users_in_calls
~~~

Keep **peak bandwidth** (sizing the link) separate from **monthly volume** (billing), and state the hours of use and concurrency assumed. Prices must be verified at the time of writing.
