# 0002 · Authoritative world in a single goroutine

- **Status:** accepted (2026-09-29)

## Context

Positions, collisions, room permissions and conversation membership must be trustworthy. Clients cannot decide where they are.

## Decision

- Each office has one `World` that owns all of its state in **a single goroutine**. Connections talk to it only through an event queue, so the hot path takes no locks.
- The client sends **intent** (a direction), never a position. The server integrates movement using the configured speed and the map collisions.
- The client predicts locally and the server sends acknowledgements with the authoritative position; small differences are smoothed, large ones are snapped.
- Simulation and send rate: **15 Hz** by default (`OG_TICK_HZ`, 5 to 30). Events are never sent per frame.
- A **spatial grid** (128 px cells) with **areas of interest**: each player only receives entities from nearby cells (radius of 2 cells by default). Entering or leaving the area produces incremental events.
- Global presence (people list, status) travels in separate, summarised messages without positions.
- Pending positions are **coalesced per client**: when a client's queue is more than half full, sending is deferred and the newest position overwrites the stale one. Reliable messages (chat, control) are never dropped; if their queue overflows, the connection is closed (the client reconnects and resyncs).
- Movement is **never** written to the database. Only the last position is saved, when a player leaves.

## Consequences

- A very large office is limited by one goroutine's core. The real limit depends on measurement (benchmarks pending).
- State lives in memory, so restarting the process drops connections; clients reconnect and the server restores the map and last position from SQLite.
