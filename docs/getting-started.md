# Getting started

This guide runs the full development stack on one machine: LiveKit, the Go server and the Vite dev server.

> The dev stack is **not** for production. It uses the well-known LiveKit development key pair and an unauthenticated join endpoint. Production mode refuses to start with those defaults (see [Privacy and security](privacy-and-security.md)).

## Requirements

| Tool | Notes |
| --- | --- |
| Go | 1.26 or newer |
| Node.js and pnpm | developed with Node 26.4 and pnpm 11.9; other recent versions are untested |
| LiveKit server | `brew install livekit` on macOS, or the official release binary / image on Linux |
| A Chromium-based browser | for the end-to-end tests: Google Chrome |

## Run it

~~~bash
git clone https://github.com/guhcostan/open-gather.git
cd open-gather
./scripts/dev.sh
~~~

The script starts three processes and writes their logs to `.run/`:

| Service | URL |
| --- | --- |
| App (Vite) | http://127.0.0.1:5173 |
| Go server | http://127.0.0.1:8080 (`/healthz`, `/readyz`, `/metrics`) |
| LiveKit (dev mode) | ws://127.0.0.1:7880 |

Open the app in **two different browsers or profiles** (a session is stored in a cookie), pick a name and avatar, walk toward each other, and enable audio and video when asked.

## Run the tests

~~~bash
# Go: world simulation, collisions, access rules, proximity groups, backpressure
cd server && go test -race ./...

# Web: type-check and production build
cd web && pnpm install && pnpm exec tsc --noEmit && pnpm exec vite build
~~~

The end-to-end smoke test drives two real Chrome instances with fake camera and microphone devices against the running dev stack:

~~~bash
cd e2e && pnpm install && node smoke.mjs
~~~

## Configuration

Everything is configured through environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OG_ENV` | `dev` | `dev` or `production` |
| `OG_ADDR` | `:8080` | HTTP listen address |
| `OG_DB` | `data/opengather.db` | SQLite file (WAL mode) |
| `OG_STATIC_DIR` | empty | Directory with the built web app to serve |
| `OG_ALLOWED_ORIGINS` | empty | WebSocket origin patterns; **required in production** |
| `OG_OFFICE_SLUG` / `OG_OFFICE_NAME` | `default` | Single-office deployment identity |
| `OG_SESSION_DAYS` | `30` | Session cookie lifetime |
| `OG_TICK_HZ` | `15` | World tick rate, 5 to 30 |
| `OG_AOI_CELLS` | `2` | Area-of-interest radius in 128 px cells |
| `OG_MAX_PLAYERS` | `2000` | Hard cap per office |
| `OG_MAX_GROUP` | `8` | Maximum people in a proximity group |
| `LIVEKIT_URL` | empty | Public `ws(s)://` URL browsers use; empty disables media |
| `LIVEKIT_API_URL` | derived | `http(s)://` URL the server uses for admin calls |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | empty | LiveKit credentials |

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /healthz` | liveness |
| `GET /readyz` | readiness (pings the database) |
| `GET /metrics` | Prometheus text metrics (players, tick histogram, queues, media counters) |
| `POST /api/join` | dev-only user creation (returns 403 in production) |
| `GET /api/me` | current session |
| `GET /ws` | the world WebSocket |
