# 0010 · Gather-style social features

## Context

The MVP covered presence, proximity calls, rooms, chat and administration. The remaining gap to a usable virtual office was the social layer: reactions, things to interact with, walking together, lockable doors, broadcasting and shared drawing.

## Decision

- Emotes are seven fixed protocol IDs (keys 1-7, reaction buttons), fanned out to the sender area of interest over the lossy path (dropped for congested clients, never a kick) with a 700 ms server cooldown. Invisible players cannot emote.
- Interactive objects (note, embed, image, whiteboard, portal, spotlight) are map props. Their content is validated at map-save time (notes bounded, URLs must be absolute https without credentials) and stripped from the public map; it is delivered only to a player standing next to the object and allowed in its area. Embedded sites and images load only after an explicit click, in a sandboxed iframe or referrerless image.
- Follow is server-driven: the follower client stops predicting and applies authoritative self positions at the 15 Hz tick. Paths are BFS over tiles the follower may stand on (portals excluded), recomputed at most every 400 ms, capped at 64 followers. Any movement key ends it; it ends when the leader leaves or turns invisible.
- Portals fire on arrival only (tracked per player, reset on step-off) and never into solid tiles or rooms the player may not enter, including locked ones.
- Lockable rooms are in-memory door state on top of access rules: anyone inside can lock, everyone inside at that moment is admitted, admins bypass, an empty room unlocks itself. Knocks reach only people inside, expire after 60 s, and answers admit one visitor at a time. Movement enforces it, so media isolation follows automatically. Lock and board-clear actions are written to the audit log.
- Spotlight is one extra SFU room per office with a single speaker (first eligible player on a pad keeps it). The speaker leaves their conversation while on air; the audience gets subscribe-only tokens. Stepping off or withdrawing consent revokes everything, and the room is part of the reconciler snapshot.
- Whiteboards belong to whiteboard props, bounded (1500 strokes, 2000 points per stroke, 50 viewers, 100 points per message). Strokes relay to viewers including an echo to the author so a rejected edit never diverges the canvases; deletes require ownership (admins may delete any); only admins clear. Boards persist debounced to SQLite and reload on start; shutdown flushes synchronously.

## Consequences

- Performance: follow pathfinding is bounded BFS on the world goroutine; spotlight adds one SFU room; whiteboard traffic is batched (50 ms) and bounded per message. No per-frame sends were added.
- Maintenance: new prop kinds need art, dimensions on both client and server, and editor support.
- Limits, stated plainly: no ban list or temporary mute; the audit log is not tamper-proof; embedded sites can still refuse framing (the dialog says so); the canvas itself is not screen-reader operable.

