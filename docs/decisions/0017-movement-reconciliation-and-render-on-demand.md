# 0017: Shared movement rules, full reconciliation and render on demand

Date: 2026-10-02. Status: accepted.

## Context

Running on the public demo (the free Oracle micro VM) pulled the player back while the key was held. Three causes were found and reproduced:

1. **Different wall stops.** The server integrated one step per tick (1/15 s, about 9.6 px when running) and refused the whole step at a wall, so it stopped several pixels before the wall the client walked up to in per-frame steps. Every run into a wall ended with a pull back.
2. **Late ticks lost distance.** A tick later than 250 ms (a CPU-starved VM) was clamped to 250 ms, so the server fell behind the client, which then snapped back. The same clamped step (36 px) could cross a one-tile wall.
3. **Reconciliation overshot.** An acknowledgement moved the player by half the error but left the recorded positions of the inputs still in flight unchanged, so each later acknowledgement applied the same error again. Corrections moved the drawn avatar directly, so network jitter showed as steps back.

The browser also redrew the scene 60 times a second when nothing moved, which in an office is most of the time.

## Decision

- **One movement rule on both sides** (`world.move` on the server, `WorldView.moveBody` in the client and the dead-reckoning shadow): the distance is walked in sub-steps of at most 4 px, and a blocked axis moves to the point of contact with the tile edge. The result does not depend on how time was split into ticks or frames, so prediction, extrapolation and the server agree at walls. A late tick integrates up to 1 s.
- **The client integrates its own movement up to the instant of every input** (direction, run and heartbeat), the same instant the server applies it, instead of up to the last frame.
- **Full reconciliation**: an acknowledgement applies the whole error to the position and to every input still in flight. The avatar is drawn at the position plus a visual offset that absorbs the correction and fades (120 ms time constant, on each axis never faster than 60 % of the slowest per-axis walking speed, that of a diagonal walk), so a held key never draws a step back in any direction. Only corrections above 128 px skip blending (a real teleport resets the offset anyway).
- **Render on demand**: PixiJS no longer renders on its own ticker. The frame loop (input, extrapolation, animation) still runs every display frame, but it draws only when the camera, a sprite's position or picture, or a pet changed, when a timed effect is on screen (emote, banner, walk-to marker, locate pulse), or when the session changed something (people, status, speaking, map). A 250 ms heartbeat draws anyway as a safety net.
- **Cheaper world frames**: each client's pending records are a slice in queue order with an open-addressing index (no Go map on the hot path), and every entity formats its state record once per record and shares the bytes with all observers.

## Impact

- Performance: on an Apple M1 Pro, `go test -bench Tick ./internal/world` (300 players, a third changing direction every tick) went from 1.99 to 0.52 ms per tick concentrated in the reception and from 1.12 to 0.38 ms spread over the map; bytes on the wire are unchanged. A Chrome page with nobody moving draws about 4 frames a second instead of 60; renderer plus GPU process CPU went from about 26 % to 9 % of one core in the same run. Local single-machine numbers, not a capacity claim.
- Maintenance: `world.move` and `WorldView.moveBody` must change together (the Go tests and the `movement` scenario check that they stop at the same spot). Anything new that changes the picture outside sprites and the camera must set `dirty`; the `idle` scenario checks that changes are drawn.
- Installation: none. The protocol is unchanged.
