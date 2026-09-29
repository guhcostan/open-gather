# Overview

**Open Gather** is an open source 2D virtual office in the spirit of the classic Gather experience. Your team walks around a pixel-art map, meets colleagues, talks by proximity, joins meeting rooms and shares screens, all in the browser.

The name is **provisional**, and the project has no affiliation with the original Gather product. It uses only original code and assets (or compatible licences).

## What makes it different: efficiency

Most virtual offices are heavy. Open Gather is designed around a budget:

- **Server**: one Go process runs an authoritative world per office, with a spatial index and areas of interest, so a player is never compared against everyone else.
- **Network**: movement is sent as small, batched, incremental updates at 10-15 Hz. Slow clients get the newest position instead of a growing backlog.
- **Browser**: the whole static map is baked into one texture; only what the camera can see is drawn; hidden tabs stop rendering but keep calls alive; an economy mode caps the frame rate.
- **Media**: audio and video go through a real SFU (LiveKit). Rooms are small and created on demand, and only authorised tracks are subscribed.

> These are design goals. Capacity numbers are **targets to validate**, not proven results. See [Efficiency and benchmarks](efficiency-and-benchmarks.md) and [Status](status.md).

## How the pieces fit

~~~text
 Browser (React + PixiJS)
    |  WebSocket (world, presence, chat)         WebRTC (audio/video/screen)
    v                                                    v
 Go server  -- issues scoped tokens / removes users -->  LiveKit SFU
    |
    v
 SQLite (WAL): offices, users, memberships, sessions, maps
~~~

Three concerns are kept apart on purpose:

1. **World state, presence and movement**: in memory, in the Go server.
2. **Durable data**: SQLite. Movement is never persisted, only the last position when someone leaves.
3. **Audio, video and screen sharing**: the SFU. The app server only decides *who may join which room*.

## Where to go next

- [Getting started](getting-started.md): run the whole stack locally.
- [Architecture](architecture.md): how the server, client and SFU cooperate.
- [Proximity and media](proximity-and-media.md): how conversations form and split.
- [Privacy and security](privacy-and-security.md): consent, access control and current limitations.
- [Status and roadmap](status.md): what is verified, what is not.
