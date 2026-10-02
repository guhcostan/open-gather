# 0006 · Movement is sent as state changes, not as a stream of positions

- **Status:** accepted (2026-09-29). Supersedes the "position of every moving player every tick" behaviour of the first slice.

## Context

The first implementation sent the position of every moving player to every observer on every tick (15 Hz). The load generator (see [Benchmark results](../benchmark-results.md)) showed the cost is quadratic: with 1,000 bots in one small area the server wrote 58 MB/s, the mean tick took 27.6 ms and the slowest tick 143 ms, which is over the 66.7 ms budget.

## Decision

Movement is deterministic (direction and speed are constant until an input, a wall or a locked door changes them), so the server publishes a **state record** only when the state changes, and clients keep walking the entity with the same rules:

1. A record is ~[id, x, y, d]: rounded position plus a direction code (`d = facing | (dx+1)<<2 | (dy+1)<<4`).
2. The server keeps, per moving player, a *shadow* position that follows exactly what a client would extrapolate (static walls only, axis-separated collision; the sub-step rule is now the one in [0017](0017-movement-reconciliation-and-render-on-demand.md)).
3. A record is sent when the direction changes, when the real position diverges from the shadow by more than 1.5 px (for example a door that is locked for that player), and as a 1 s safety resync.
4. Anyone who starts seeing an entity (entering a cell of interest, reconnecting, or a hidden tab coming back and sending `sync`) receives its current state.
5. Clients blend corrections over ~80 ms and snap when they exceed 24 px.

The spatial grid and interest areas still follow the real position on every tick, independent of records.

## Impact (measured, loopback, generator on the same host, single runs)

| Run | Server output KB/s | Mean tick ms | Max tick ms |
|---|---|---|---|
| 1,000 concentrated, before -> after | 58,188 -> 11,491 | 27.6 -> 6.7 | 142.9 -> 59.8 |
| 1,000 distributed | 27,127 -> 6,457 | 16.1 -> 5.5 | 67.5 -> 18.7 |
| 500 concentrated | 14,586 -> 2,962 | 7.6 -> 3.8 | 56.0 -> 11.4 |

Propagation latency did not change (median 30-46 ms, p95 about 65 ms): it is bounded by the 15 Hz flush, not by the number of records. A real Chrome check shows a remote avatar tracked within 1.7-2.5 px while walking and converging to the exact stop position.

## Consequences

- **Performance:** bandwidth now depends on how often people change direction, not on how long they walk. The worst case (everybody zig-zagging inside one area) is still quadratic, only with a smaller constant.
- **Maintenance:** the movement rule exists twice (Go shadow, TypeScript extrapolation) and must stay identical. `TestDeadReckoning...`, `TestDivergenceIsCorrected` and the "remote view tracks a walk" browser check guard it.
- **Behaviour:** a player pushing against a door that is locked for them produces a correction each tick until they stop. Hidden tabs do not extrapolate and therefore ask for a fresh snapshot when shown again.
- **Install:** none.
