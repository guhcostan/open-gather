<p align="center">
  <img src="site/assets/banner.png" alt="Open Gather: a lightweight, open source virtual office" width="100%">
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-3cc9b0?style=flat-square"></a>
  <a href="https://github.com/guhcostan/open-gather/actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/guhcostan/open-gather/ci.yml?branch=main&style=flat-square&label=CI"></a>
  <a href="https://github.com/guhcostan/open-gather/stargazers"><img alt="GitHub stars" src="https://img.shields.io/github/stars/guhcostan/open-gather?style=flat-square&color=ffb84d"></a>
  <a href="https://github.com/guhcostan/open-gather/pkgs/container/open-gather"><img alt="Docker image on GHCR" src="https://img.shields.io/badge/docker-ghcr.io%2Fguhcostan%2Fopen--gather-2496ED?style=flat-square&logo=docker&logoColor=white"></a>
  <img alt="Status: alpha" src="https://img.shields.io/badge/status-alpha-ffb84d?style=flat-square">
</p>

<h1 align="center">Open Gather</h1>

<p align="center">
  <b>A lightweight, open source, self-hosted 2D virtual office.</b><br>
  Walk around a pixel-art map, meet your team and talk with proximity audio and video, without burning CPU, RAM, GPU or bandwidth.
</p>

<p align="center">
  <a href="https://office.152-67-49-137.sslip.io"><b>Live demo</b></a> ·
  <a href="https://guhcostan.github.io/open-gather/">Website</a> ·
  <a href="https://guhcostan.github.io/open-gather/docs/">Docs</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="docs/faq.md">FAQ</a> ·
  <a href="#status">Status</a> ·
  <a href="#contributing">Contributing</a>
</p>

Open Gather is a virtual office for remote and hybrid teams in the spirit of the classic Gather experience: everyone has a pixel-art avatar on a shared 2D map, and a call starts when you walk up to someone and ends when you walk away. It runs in the browser, you host it yourself with one Docker Compose file (one Go binary, SQLite and a LiveKit media server), and it needs no paid service.

**Try it now:** the **[live demo](https://office.152-67-49-137.sslip.io)** runs on a free Oracle Cloud VM (1 GB of RAM, so be gentle). No sign-up beyond a name; anyone can join, and the map, office chat and whiteboards reset every 6 hours. Open it in two browser profiles and walk the avatars together to see a call start.

> **MVP / alpha.** The whole loop works and is tested in real browsers: avatars, movement, proximity audio and video through a real SFU, private meeting rooms, screen sharing, chat, invites, an admin map editor and a Docker install. **Capacity is not established yet**: on the free 1 GB demo VM a single run over the internet stayed smooth at 100 bots and saturated at 500, and only small calls (4 people with video, 20 in audio groups) ran clean. Read [Status](#status) before you rely on anything. "Open Gather" is a **provisional name** and the project is not affiliated with the original Gather product.

⭐ **If you would like a virtual office you can own, star the repository.** It is the simplest way to help other teams find it and to tell us this is worth building.

## Why Open Gather

Virtual offices are usually heavy on the browser, the server and the bill. Open Gather is built around an efficiency budget:

- **A world server that does less work.** One Go goroutine owns each office. A spatial grid and areas of interest mean a player is only ever compared with the people near them, updates are batched at 10-15 Hz, and because walking is deterministic the server sends *state changes* instead of a position stream (about 5x less traffic than the first version in our local runs, see [decision 0006](docs/decisions/0006-state-change-records.md)).
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
| **Proximity conversations** | Audio and video start when you get close and stop when you leave, with hysteresis and small groups. |
| **Consent and status** | Nothing is captured before you opt in. Available, busy, away and invisible; busy never joins a call automatically. |
| **Avatars** | Procedural pixel-art characters with big heads and a three-frame walk cycle: skin, six hairstyles, hair colour, shirt, trousers. |
| **Look** | 16 px tiles, outlined and shaded props, textured floors and walls, dialog-window UI and a pixel font. All original. |
| **World** | Keyboard movement with collisions, camera follow, animation, prediction for you and dead-reckoned movement for others. |
| **Getting around** | Run with Shift or toggle it with R (2x speed); double-click any spot to run there along a path the server finds; "Walk to" anyone from the people panel. |
| **Pets** | Pick a companion (cat, dog, bunny, fox, chick, slime, owl, axolotl) that walks your trail a step behind, goes around corners with you and sits beside you when you stop. Drawn by code, animated locally: zero bandwidth. |
| **Presence** | Wave at anyone in the office (they can run straight to you), raise your hand (H), set a status note, dance (Z). Busy means do not disturb. |
| **Minimap** | The whole office at a glance with live head counts per area; click to run there (M toggles). |
| **Phones and tablets** | An on-screen movement pad appears on touch screens. Optional sounds and desktop notifications for waves, knocks and direct messages. |
| **Announcements and help** | Administrators can send a banner to everyone online (audited, never stored). Press ? for every shortcut. Turn anyone in a call down or mute them for yourself only. |
| **Meeting rooms** | Map areas with explicit access rules (open, members, admins, list) enforced by the server. |
| **Lockable rooms and knocking** | Anyone inside can lock a room; outsiders knock and are let in one at a time; empty rooms unlock themselves. |
| **Private offices** | Six small offices behind a hall, each with its own call. A free office is open and lockable; an administrator assigns one to a person from the editor, and from then on only the owner (and admins) walk in, while visitors knock and the owner decides. |
| **Reactions** | Seven quick emotes over your avatar, keys 1-7. |
| **Interactive objects** | Notes, embedded sites and images (press X nearby), drawn by code and editable by admins. |
| **Follow and portals** | Server-guided following with request-to-lead, and portals that teleport across the office. |
| **Spotlight** | Step on the pad to broadcast audio, video and screen share to the whole office. |
| **Shared whiteboards** | Collaborative pen and text boards that persist and survive restarts. |
| **Chat** | Office (last messages are kept), conversation and direct messages (never stored). |
| **Invites, roles and administration** | Administrators mint, list and revoke invite links, promote or demote members, remove people and read an activity log; production joins require an invite. |
| **Office editor** | Administrators paint walls, place objects, draw meeting rooms with access rules and assign desks; changes go live for everyone and persist. |
| **Profile** | Change your name and avatar any time. |
| **Screen sharing** | Inside a live conversation, up to 1080p with cheap low layers for small tiles; expand over the map, full screen or picture-in-picture; a badge shows who is presenting. |
| **Self-hosted** | One Go binary, SQLite in WAL mode, LiveKit. No paid service required. |

<p align="center">
  <img src="site/assets/cast.png" alt="Six pixel-art avatars" width="640"><br>
  <img src="site/assets/walk.gif" alt="An avatar walking in four directions" width="360">
</p>

## Quick start

Three ways in, from zero effort to hacking on the code.

**1. Use the [live demo](https://office.152-67-49-137.sslip.io).** Nothing to install.

**2. Self-host with Docker.** Evaluate the whole stack locally (the first person to join becomes the administrator):

~~~bash
git clone https://github.com/guhcostan/open-gather.git
cd open-gather
docker compose -f deploy/docker-compose.local.yml up --build
# open http://localhost:8080
~~~

For a real server, the production Compose file uses the prebuilt image `ghcr.io/guhcostan/open-gather` (linux/amd64 and linux/arm64) and adds automatic HTTPS (Caddy), a LiveKit media server and invite-only joins. Follow the [self-hosting guide](deploy/README.md); it also shows how to try it without owning a domain.

**3. Develop.** You need **Go**, **Node.js with pnpm** and a **LiveKit server** binary (on macOS: `brew install livekit`).

~~~bash
git clone https://github.com/guhcostan/open-gather.git
cd open-gather
./scripts/dev.sh
~~~

Then open http://127.0.0.1:5173 in **two different browser profiles**, pick a name and avatar, walk toward each other and enable audio and video when asked.

> The dev stack uses LiveKit's public development keys and an unauthenticated join endpoint. It is for local use only. Production mode refuses to start with those defaults.

Tests:

~~~bash
cd server && go test -race ./...      # world simulation, store, media
cd web && pnpm exec tsc --noEmit      # type-check the client
cd e2e && pnpm install && node run.mjs   # real Chrome + real LiveKit, own server and database
~~~

More in the [getting started guide](docs/getting-started.md), including every environment variable.

## FAQ

**Is it an open source Gather alternative?** It is an independent, AGPL-3.0 project inspired by the classic Gather experience, with no affiliation and no shared code, maps, sprites or branding. If you want a 2D virtual office with proximity video that you host and inspect yourself, that is the use case.

**What does it cost?** Nothing but the machine. No paid service is required, and the public demo runs on a free 1 GB VM.

**How many people can it hold?** We do not claim a number yet. One run on the free 1 GB Oracle VM, loaded over the internet, was smooth at 100 bots, slower in the worst cases at 200 and saturated at 500; a 4-person video call and 20 people in audio groups were clean, larger media runs lost packets. Details in [Benchmark results](docs/benchmark-results.md).

**Is anything recorded?** No. Audio, video and screen shares only pass through the media server, direct and conversation chat are never stored, and nothing is captured before you opt in. The office chat keeps its last 500 messages. See [Privacy and security](docs/privacy-and-security.md).

More answers in the [FAQ](docs/faq.md). AI assistants and tools can read a summary of the whole project at [llms.txt](https://guhcostan.github.io/open-gather/llms.txt) or every doc page in one file at [llms-full.txt](https://guhcostan.github.io/open-gather/llms-full.txt).

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

Last updated 2026-10-01. Everything below was executed on macOS (Apple M1 Pro), Go 1.26.5, Google Chrome with fake camera and microphone, LiveKit 1.13.7. Details and the exact counts: [Status](docs/status.md).

Planned next: breakout rooms, a stage, audio-only areas set by administrators and a lounge, see the [Roadmap](docs/roadmap.md). Hosted plans are being planned on top of the open source project: [Business model](docs/business-model.md).

| Area | State |
| --- | --- |
| Go tests (world rules, proximity groups, dead reckoning, map reload, store, media tokens and reconciliation), also with the race detector | **pass** |
| Real-browser suite (Chrome + real LiveKit): proximity calls with real audio/video RTP, consent and busy, private rooms, screen share, invites and admin-only actions, map editor, chat and profile, token replay/tamper/expiry attacks, reconnection and restart persistence, member administration, an automated accessibility audit (axe-core), reactions/objects/follow/portals/lockable rooms/whiteboards, spotlight broadcasts with real RTP, running and walk-to, pets, shared-screen view controls, waves, raised hands, status notes, the minimap and the touch pad, administrator announcements, the shortcuts help, per-person call volume and private offices (assign, knock, let in, shared call) | **pass** |
| Gauntlet regression checks: chat composer survives repeated sends; small-screen chat controls and expanded reactions are clickable; pet trail, catch-up and resting visibility | Local results and limitations in [Status](docs/status.md); [review procedure](docs/gauntlet.md) |
| Docker: image builds, Compose local stack passes the browser scenarios, production mode in the container refuses insecure config and requires invites | **verified locally** |
| Production Compose (Caddy, TLS, LiveKit) on a public host: the public demo on an Oracle Always Free micro VM, real audio/video over UDP across the internet | **verified** (one smoke run, 2 people); TURN relay through UDP-blocked networks and load on that host are **not tested** |
| Load, scenario A (no media, up to 1,000 bots) and a 500-client mass reconnect | **run locally, generator on the same host**: not a capacity claim, see [results](docs/benchmark-results.md) |
| Media through a real SFU with synthetic Opus/VP8 (scenarios B and D, a scaled C): clean up to 40 people in calls, 20-person meeting with 6-video cap and a screen share, all 0 % loss | **run locally, generator on the same laptop**; full-size C (100 people) attempted and **invalid** on one machine |
| The same load on the free Oracle micro VM (production stack, generator on another machine over the internet): 500 bots joined with nothing kicked; 100 smooth, 200 working with slower worst cases, 500 saturated; one 4-person video call and 20 people in audio groups clean, larger media runs lost packets (most likely the VM's capped CPU; the generator side was not measured) | **measured once** ([results](docs/benchmark-results.md#on-a-free-cloud-vm-over-the-internet)); not a capacity claim |
| TURN through restrictive networks, two-hour soak (a 10-minute presence soak was run), browser FPS on the *reference* laptop (an M1 Pro reaches 60 FPS with 300 bots around), the 2 vCPU / 4 GB reference server | **not run** |
| Cost numbers | **formula only** ([bench/cost.py](bench/cost.py)); no prices verified |

### Targets we want to validate

Remote movement latency p95 below 150 ms (locally about 65 ms on loopback; not yet measured across a network), about 60 FPS on a laptop with integrated graphics (30 FPS or better in economy mode) and no unexplained memory growth. See [Efficiency and benchmarks](docs/efficiency-and-benchmarks.md).

## Repository layout

~~~text
server/   Go: HTTP + WebSocket, authoritative world, SQLite, LiveKit integration, load generator
web/      TypeScript + React + Vite + PixiJS client
e2e/      real-browser end-to-end tests and art generation
bench/    benchmark scripts, raw results and the cost model
deploy/   Dockerfile, Compose files (local and production), Caddyfile
site/     landing page and docs site (GitHub Pages)
docs/     documentation sources and architecture decision records
scripts/  local development stack
~~~

## Contributing

Issues, careful bug reports, tests and measurements are all welcome. Read [CONTRIBUTING](docs/contributing.md) and [AGENTS.md](AGENTS.md) (also useful for humans) first. Everything in the repository is written in **English**. Found a security problem? Follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

Using it with your team? Tell us how in an issue: real use cases decide what gets built next.

## Licence and credits

- Code: **AGPL-3.0** ([LICENSE](LICENSE)), with no additional restrictions on commercial use.
- Sprites, map, UI frames and site art are drawn by this project's own code (`web/src/game/art`, `e2e/art.mjs`); no third-party art, and no Gather, Nintendo or Game Freak assets, are used. The style is inspired by 2000s handheld RPGs, nothing is copied ([details](docs/art-style.md)).
- Font: [Pixelify Sans](https://github.com/eifetx/Pixelify-Sans), SIL Open Font License 1.1 (`web/src/assets/fonts`).
- Built on open source: [Go](https://go.dev), [coder/websocket](https://github.com/coder/websocket), [modernc.org/sqlite](https://gitlab.com/cznic/sqlite), [React](https://react.dev), [Vite](https://vite.dev), [PixiJS](https://pixijs.com), [LiveKit](https://livekit.io) and [marked](https://marked.js.org). The third-party licence inventory is in [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).
