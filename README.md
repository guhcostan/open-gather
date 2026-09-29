<p align="center">
  <img src="site/assets/banner.png" alt="Open Gather: a lightweight, open source virtual office" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-3cc9b0?style=flat-square"></a>
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-ffb84d?style=flat-square">
  <img alt="Go" src="https://img.shields.io/badge/server-Go-00ADD8?style=flat-square">
  <img alt="TypeScript, React and PixiJS" src="https://img.shields.io/badge/client-TypeScript%20%C2%B7%20React%20%C2%B7%20PixiJS-4a8fe0?style=flat-square">
  <img alt="Media: LiveKit" src="https://img.shields.io/badge/media-LiveKit-8a63d2?style=flat-square">
</p>

<h1 align="center">Open Gather</h1>

<p align="center">
  <b>A lightweight, open source 2D virtual office.</b><br>
  Walk around a pixel-art map, meet your team and talk by proximity, without burning CPU, RAM, GPU or bandwidth.
</p>

<p align="center">
  <a href="https://guhcostan.github.io/open-gather/">Website</a> ·
  <a href="https://guhcostan.github.io/open-gather/docs/">Docs</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#status">Status</a> ·
  <a href="#contributing">Contributing</a>
</p>

> **Alpha software.** The core loop works (two browsers, synchronised avatars, real proximity audio and video through a real SFU) but there are no invites yet, no load tests and no production installer. Read [Status](#status) before you rely on anything. "Open Gather" is a **provisional name** and the project is not affiliated with the original Gather product.

## Why Open Gather

Virtual offices are usually heavy on the browser, the server and the bill. Open Gather is built around an efficiency budget:

- **A world server that does less work.** One Go goroutine owns each office. A spatial grid and areas of interest mean a player is only ever compared with the people near them, and updates are batched at 10-15 Hz instead of sent every frame.
- **Slow clients cannot hurt fast ones.** Queues are bounded; stale positions are overwritten while chat and control messages are kept.
- **A frugal browser client.** The whole static map is baked into one texture, only what the camera sees is drawn, hidden tabs stop rendering (calls keep running) and there is an economy mode.
- **Real media infrastructure, used sparingly.** Audio and video go through a self-hosted [LiveKit](https://livekit.io) SFU. Rooms are small and created on demand, tokens are scoped to a single room and access is revoked on the server when you leave.

<p align="center">
  <img src="site/assets/game-social.png" alt="In-game screenshot: three avatars in the social area with couches, a rug and a table" width="49%">
  <img src="site/assets/game-desks.png" alt="In-game screenshot: an avatar walking through the desk area" width="49%">
  <br><sub>In-game screenshots (UI hidden). The look is an original take on a 2000s handheld-RPG style, see <a href="docs/art-style.md">Art style</a>.</sub>
</p>

<p align="center">
  <img src="site/assets/map.png" alt="The starter office: reception, twelve individual desks, four meeting rooms and a social area" width="720">
  <br><sub>The starter office: reception, individual desks, four meeting rooms with different access rules and a social area. This image is baked by the game itself.</sub>
</p>

## Features

| | |
| --- | --- |
| **Avatars** | Procedural pixel-art characters with big heads and a three-frame walk cycle: skin, six hairstyles, hair colour, shirt, trousers. |
| **Look** | 16 px tiles, outlined and shaded props, textured floors and walls, dialog-window UI and a pixel font. All original. |
| **World** | Keyboard movement with collisions, camera follow, animation, prediction for you and interpolation for others. |
| **Proximity conversations** | Audio and video start when you get close and stop when you leave, with hysteresis and small groups. |
| **Consent and status** | Nothing is captured before you opt in. Available, busy, away and invisible; busy never joins a call automatically. |
| **Meeting rooms** | Map areas with explicit access rules (open, members, admins, list) enforced by the server. |
| **Chat** | Office, conversation and direct messages. |
| **Screen sharing** | Inside a live conversation. |
| **Self-hosted** | One Go binary, SQLite in WAL mode, LiveKit. No paid service required. |

<p align="center">
  <img src="site/assets/cast.png" alt="Six pixel-art avatars" width="640"><br>
  <img src="site/assets/walk.gif" alt="An avatar walking in four directions" width="360">
</p>

## Quick start

You need **Go**, **Node.js with pnpm** and a **LiveKit server** binary (on macOS: `brew install livekit`).

~~~bash
git clone https://github.com/guhcostan/open-gather.git
cd open-gather
./scripts/dev.sh
~~~

Then open http://127.0.0.1:5173 in **two different browser profiles**, pick a name and avatar, walk toward each other and enable audio and video when asked.

> The dev stack uses LiveKit's public development keys and an unauthenticated join endpoint. It is for local use only. Production mode refuses to start with those defaults.

Tests:

~~~bash
cd server && go test -race ./...      # world simulation and rules
cd web && pnpm exec tsc --noEmit      # type-check the client
cd e2e && node smoke.mjs              # two real Chrome instances against the running stack
~~~

More in the [getting started guide](docs/getting-started.md), including every environment variable.

## Architecture

~~~mermaid
flowchart LR
  subgraph Browser
    UI[React UI]
    W[PixiJS world]
    LK[LiveKit client]
  end
  subgraph Server[Go server]
    WORLD[Authoritative world<br/>spatial grid + interest areas]
    TOK[Token issuer]
  end
  DB[(SQLite WAL)]
  SFU[LiveKit SFU]
  UI --- W
  W <-- WebSocket --> WORLD
  WORLD --> DB
  WORLD --> TOK
  TOK -. scoped tokens / remove user .-> SFU
  LK <-- WebRTC --> SFU
~~~

World state, durable data and media transport are deliberately separate, so the media server can move to its own host and offices can be spread across instances later. Details: [architecture](docs/architecture.md) and the [decision records](docs/decisions/).

## Status

Last updated 2026-09-29. Verified on macOS (Apple M1 Pro), Go 1.26.5, Google Chrome with fake camera and microphone devices, LiveKit 1.13.7 in dev mode on localhost.

| Area | State |
| --- | --- |
| World simulation unit tests (collisions, speed, room access, area of interest, proximity groups, busy/no-consent, chains, backpressure) | **10/10 pass**, also with the race detector |
| Two-browser Chrome smoke test: movement sync, proximity conversation with real audio and video RTP through LiveKit, revocation on leave | **15/15 checks pass** |
| Screen sharing, office and direct chat, reconnection, persistence across restarts, economy mode | implemented, **not verified end to end** |
| Invites and access control, admin map editor, desk assignment | **not implemented** |
| Docker Compose install, backups and restore docs | **not implemented** |
| Load tests, benchmarks, capacity and cost numbers | **not run**; every performance figure in the docs is a *target*, not a result |
| Private-room isolation against an unauthorised subscription attempt | **not tested** |

The full picture, including known limitations of token revocation, is in [Status](docs/status.md) and [Privacy and security](docs/privacy-and-security.md).

### Targets we want to validate

Remote movement latency p95 below 150 ms, about 60 FPS on a laptop with integrated graphics (30 FPS or better in economy mode), and no unexplained memory growth. Planned scenarios cover 100 to 1,000 connected users without media, calls of four, a 20-person meeting with a screen share, and mass reconnects. See [Efficiency and benchmarks](docs/efficiency-and-benchmarks.md).

## Repository layout

~~~text
server/   Go: HTTP + WebSocket, authoritative world, SQLite, LiveKit integration
web/      TypeScript + React + Vite + PixiJS client
e2e/      real-browser end-to-end tests and art generation
site/     landing page and docs site (GitHub Pages)
docs/     documentation sources and architecture decision records
scripts/  local development stack
~~~

## Contributing

Issues, careful bug reports, tests and measurements are all welcome. Read [CONTRIBUTING](docs/contributing.md) and [AGENTS.md](AGENTS.md) (also useful for humans) first. Everything in the repository is written in **English**.

## Licence and credits

- Code: **AGPL-3.0** ([LICENSE](LICENSE)), with no additional restrictions on commercial use.
- Sprites, map, UI frames and site art are drawn by this project's own code (`web/src/game/art`, `e2e/art.mjs`); no third-party art, and no Gather, Nintendo or Game Freak assets, are used. The style is inspired by 2000s handheld RPGs, nothing is copied ([details](docs/art-style.md)).
- Font: [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), SIL Open Font License 1.1 (`web/src/assets/fonts`).
- Built on open source: [Go](https://go.dev), [coder/websocket](https://github.com/coder/websocket), [modernc.org/sqlite](https://gitlab.com/cznic/sqlite), [React](https://react.dev), [Vite](https://vite.dev), [PixiJS](https://pixijs.com), [LiveKit](https://livekit.io) and [marked](https://marked.js.org). A full third-party licence inventory is still to be written.
