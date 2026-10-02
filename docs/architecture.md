# Architecture

## Repository layout

~~~text
server/   Go: HTTP + WebSocket, authoritative world, SQLite, LiveKit integration
  cmd/tilework/        entry point
  internal/world/        simulation, spatial grid, proximity groups, backpressure
  internal/gamemap/      map format, validation, collision grids, default office
  internal/media/        LiveKit access tokens and participant removal
  internal/store/        SQLite (WAL), migrations, sessions, invites, chat history, members and the admin audit log
  internal/httpapi/      routes, WebSocket session, limits, metrics, media reconciler
  internal/config/       environment configuration
  cmd/loadgen/           WebSocket load generator (benchmarks)
web/      TypeScript + React + Vite + PixiJS client
e2e/      real-browser end-to-end tests and asset generation
bench/    benchmark scripts and raw results
deploy/   Dockerfile, Compose files, Caddyfile
site/     this landing page and documentation (GitHub Pages)
docs/     documentation sources and architecture decision records
~~~

## The world server

Each office has one `World` that owns all state in a single goroutine (see [decision 0002](0002-authoritative-world.md)).

- **Input**: clients send a direction (-1, 0 or 1 per axis), never a position. The server integrates movement at a fixed speed and tests collisions against the compiled map.
- **Tick**: 15 Hz by default. Each tick advances moving players, evaluates proximity (about 4 Hz), and flushes one coalesced frame per client.
- **State records, not position streams**: movement is deterministic, so a record is sent only when direction changes, reality diverges from what clients extrapolate, or as a 1 s resync ([decision 0006](0006-state-change-records.md)).
- **Spatial index and area of interest**: a grid of 128 px cells. A player subscribes to the cells around it; entering or leaving that window produces enter/leave events instead of resending everything.
- **Backpressure**: each client has a bounded outbound queue. Stale positions are overwritten for slow clients, while reliable messages (chat, control) are preserved; a client that cannot drain reliable traffic is disconnected and resyncs on reconnect.
- **Persistence**: nothing per step. The last position is written when a player leaves; maps, users, invites, sessions and the office chat history live in SQLite. Direct and conversation chat are never stored.
- **Admin edits**: the map can be replaced at runtime by an administrator; the world validates, hot-swaps and saves it ([decision 0007](0007-invites-roles-and-map-editing.md)).

## The client

- **React** owns the UI (panels, dialogs, chat). **PixiJS** owns the world and runs its own ticker, so movement and animation never pass through React renders.
- The static map is baked into a **single texture** (one draw call for the background). Avatars are procedural pixel art cached per look. Only entities inside the camera are drawn. The look itself is described in [Art style](art-style.md).
- **Prediction and extrapolation**: the local player moves immediately and reconciles with server acknowledgements; remote players keep walking along their last known direction with the same collision rules as the server, and corrections are blended over ~80 ms.
- Internal resolution is capped on high-density displays, hidden tabs stop rendering (calls continue), and an **economy mode** limits the frame rate to 30 and lowers resolution.

## Media

The app server never touches RTP. It decides **who may join which room** and issues a short-lived, room-scoped token. Browsers connect straight to the SFU. See [Proximity and media](proximity-and-media.md).

## Future separation

The boundaries are drawn so that later you can:

- move LiveKit to its own host: the only contract is "issue a token for room X" and "remove participant from room X";
- run several app instances, each owning a subset of offices: a world has no shared mutable state with other worlds.

None of this is implemented yet; it is just kept possible. The app server also runs a **reconciler** that removes SFU participants the world does not consider members ([decision 0008](0008-token-lifetime-and-reconciliation.md)).

## Decisions

The reasoning behind the main choices is recorded as decision records: [0001 stack](0001-stack.md), [0002 authoritative world](0002-authoritative-world.md), [0003 media rooms](0003-media-rooms.md), [0004 JSON protocol](0004-json-protocol.md), [0005 minimal LiveKit client](0005-minimal-livekit-client.md), [0006 state-change records](0006-state-change-records.md), [0007 invites, roles and map editing](0007-invites-roles-and-map-editing.md), [0008 token lifetime and reconciliation](0008-token-lifetime-and-reconciliation.md), [0009 administration and accessibility](0009-administration-and-accessibility.md).
