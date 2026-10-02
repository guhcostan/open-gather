# Efficiency and benchmarks

> **Read the caveats.** Numbers on this page and in [Benchmark results](benchmark-results.md) come from a developer laptop with the load generator on the same machine. They show *where the cost goes* and *that a change helped*; they are **not** a capacity claim for a 2 vCPU / 4 GB server. Anything not run is marked **not run**.

## Design techniques (implemented)

| Area | Technique |
| --- | --- |
| Server CPU | one goroutine per office, no locks on the hot path; spatial grid so proximity checks only look at neighbouring cells; proximity evaluated at ~4 Hz, not per movement; each state record is formatted once and its bytes shared by every observer; per-client pending records in a slice with an open-addressing index instead of Go maps ([0017](decisions/0017-movement-reconciliation-and-render-on-demand.md)) |
| Network | intent-only input; **state records instead of a position stream** ([0006](0006-state-change-records.md)); one batched frame per client per tick; integer pixel positions; no WebSocket compression; incremental enter/leave events; hand-encoded JSON without reflection |
| Slow clients | bounded queues; newest state overwrites stale ones; reliable messages preserved; disconnect on reliable overflow |
| Persistence | movement never written; last position on leave only; office chat is the only stored conversation data |
| Browser CPU/GPU | static map baked to one texture; culling to the camera; texture reuse; capped internal resolution; economy mode at 30 FPS; rendering paused in hidden tabs; **render on demand**: a still office is drawn about 4 times a second instead of 60 |
| Movement | client prediction with full reconciliation of the inputs in flight; one movement rule (4 px sub-steps, stop at the point of contact) shared by server, prediction and extrapolation, so they agree at walls and after a late tick |
| Media | real SFU (no mesh); small rooms; audio always, video limited and ranked by active speaker; simulcast and DTX; audio-only mode; capture stops when you leave a conversation |

## Researched techniques

What the literature and the tools' own documentation recommend for running many people on a small machine, and where Tilework stands. *Measured* means a number in this repository; *expected* is reasoning that still needs a run.

| Technique | Source | State |
| --- | --- | --- |
| Client-side prediction with server reconciliation: keep the inputs not yet acknowledged and correct them too | [Gambetta](https://gabrielgambetta.com/client-side-prediction-server-reconciliation.html), [Valve: Source multiplayer networking](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking) | **done** (0017): no step back under 0-120 ms of jitter in the `movement` scenario; it drew up to 4.1 px back before |
| Deterministic movement shared by both ends, independent of the time step | [Gaffer On Games: state synchronization](https://gafferongames.com/post/state_synchronization/) | **done** (0017): server and client stop on the same pixel at walls; a late tick no longer loses distance or crosses a wall |
| Send state changes, not a position stream; dead-reckon in between | Gaffer On Games, same article | **done** ([0006](decisions/0006-state-change-records.md)): about 5x less server output |
| Encode once, fan out the same bytes; keep general-purpose hash maps off the per-tick path | [Go blog: Swiss tables](https://go.dev/blog/swisstable) (how Go maps cost) | **done**, measured: world tick 1.99 -> 0.52 ms (300 concentrated) and 1.12 -> 0.38 ms (300 spread) in `go test -bench Tick` on an M1 Pro |
| Render on demand instead of a continuous 60 FPS loop | [PixiJS Application and ticker](https://pixijs.com/8.x/guides/components/application) | **done**, measured: renderer plus GPU process about 26 % -> 9 % of one core with nobody moving (`idle` scenario method, M1 Pro) |
| No per-message WebSocket compression on a CPU-capped host | [RFC 7692](https://www.rfc-editor.org/rfc/rfc7692) | **kept off**: deflate costs CPU per message, and world frames are small |
| SFU with simulcast, dynacast, adaptive stream and DTX | [LiveKit: advanced tracks](https://docs.livekit.io/home/client/tracks/advanced/) | **done** |
| Lower camera publish cost (15-20 FPS, smaller top layer): the SFU's cost grows with the packets it forwards | [LiveKit benchmark](https://docs.livekit.io/home/self-hosting/benchmark/) | **next**: media is the limit measured on the free VM (12 people with video lost 27 %); expected fewer packets per camera roughly in proportion to frame rate. Measure with `bench/run-vm-media.sh` before and after |
| Turn off redundant audio (RED) where loss is low | LiveKit, same pages | **candidate**: about doubles audio payload bytes for loss resilience; packet count is unchanged, so on a CPU-bound host the gain is expected to be small. Measure bytes and loss |
| Binary world frames | ([0004](decisions/0004-json-protocol.md) chose JSON) | **candidate**: a record is about 16-20 bytes of JSON and would be about 7 binary; roughly halves presence egress; protocol change |
| Cap the Go heap with `GOMEMLIMIT` on a 1 GB host shared with LiveKit and Caddy | [Go GC guide](https://tip.golang.org/doc/gc-guide) | **candidate** for operators: protects against memory spikes; GC CPU rises only near the limit. Not measured |
| Lower the frame loop rate when nothing moves | | **candidate**: the loop itself still runs at the display rate (renderer process about 5 % of a core idle in the run above) |

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
| B | 100 present, 20 of them in five calls of four | **run locally** for the 20 in calls (SFU side, real synthetic media); the other 80 are scenario A |
| C | 100 spread across 25 calls of four | **attempted, invalid on one laptop**; 40 people (10 calls) measured cleanly, 60+ saturate the machine |
| D | 20-person meeting with a cap on received videos and one screen share | **run locally** (cap of 6 videos, one 720p share): 0 % loss |
| browser | FPS, frame time and CPU with 300 bots around | **run on an M1 Pro** (not the reference laptop) |
| E | simultaneous join, mass reconnect, two-hour soak | join and 500-client mass reconnect **run locally**; a shorter soak was run instead of the two-hour test; the two-hour test is **not run** |

WebSocket benchmarks do not prove video capacity. Media tests must publish and consume real or representative synthetic media. The end-to-end suite proves the media *path* works (real audio and video RTP, screen share, revocation) but says nothing about capacity.

## Tools

| Tool | Purpose |
| --- | --- |
| `server/cmd/loadgen` + `scripts/bench.sh` | WebSocket bots that walk the map, propagation-latency probes, time series; starts a fresh server per run |
| `bench/run-presence.sh` | the whole scenario A / E matrix |
| `bench/report.py`, `bench/compare.py` | Markdown tables from the JSON results |
| `bench/cost.py` | cost model with **no prices built in** |
| `bench/mediagen` + `bench/run-media.sh` | synthetic but real Opus/VP8 publishers and subscribers through a LiveKit server, measuring received bitrate, loss, jitter, stalls and SFU CPU |
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
