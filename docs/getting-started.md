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
git clone https://github.com/guhcostan/tilework.git
cd tilework
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

The browser suite drives real Chrome instances (fake camera and microphone) against a **real LiveKit server**. It builds the app, starts its own server with a fresh database on port 18080 (and LiveKit in dev mode if nothing listens on 7880), and needs neither the dev stack nor any cleanup:

~~~bash
cd e2e && pnpm install
node run.mjs                     # all scenarios
node run.mjs proximity rooms     # some of them
TILEWORK_EXTERNAL_URL=http://127.0.0.1:8080 node run.mjs   # against a running stack, e.g. Docker Compose
~~~

Scenarios: proximity, consent, rooms, access, editor, social, security, resilience (see [Status](status.md) for what each proves).

## Run it with Docker

~~~bash
docker compose -f deploy/docker-compose.local.yml up --build   # http://localhost:8080
~~~

That stack is for local evaluation only. The production stack, HTTPS, ports, backups and upgrades are described in [deploy/README.md](../deploy/README.md).

## Configuration

Everything is configured through environment variables.

| Variable | Default | Purpose |
| --- | --- | --- |
| `TILEWORK_ENV` | `dev` | `dev` or `production` |
| `TILEWORK_ADDR` | `:8080` | HTTP listen address |
| `TILEWORK_DB` | `data/tilework.db` | SQLite file (WAL mode) |
| `TILEWORK_STATIC_DIR` | empty | Directory with the built web app to serve |
| `TILEWORK_ALLOWED_ORIGINS` | empty | WebSocket origin patterns; **required in production** |
| `TILEWORK_OFFICE_SLUG` / `TILEWORK_OFFICE_NAME` | `default` | Single-office deployment identity |
| `TILEWORK_SESSION_DAYS` | `30` | Session cookie lifetime |
| `TILEWORK_TICK_HZ` | `15` | World tick rate, 5 to 30 |
| `TILEWORK_AOI_CELLS` | `2` | Area-of-interest radius in 128 px cells |
| `TILEWORK_MAX_PLAYERS` | `2000` | Hard cap per office |
| `TILEWORK_MAX_GROUP` | `8` | Maximum people in a proximity group |
| `TILEWORK_JOIN_RATE` | `20` | Join requests per second per IP (raise only for load tests) |
| `TILEWORK_MEDIA_TOKEN_TTL_SECONDS` | `30` | Validity of a media join token |
| `TILEWORK_MEDIA_RECONCILE_SECONDS` | `10` | How often SFU rooms are compared with the world membership |
| `LIVEKIT_URL` | empty | Public `ws(s)://` URL browsers use; empty disables media |
| `LIVEKIT_API_URL` | derived | `http(s)://` URL the server uses for admin calls |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | empty | LiveKit credentials |

## Endpoints and command line

See the endpoint table in [WebSocket protocol](protocol.md#http-endpoints). The binary also has three one-shot commands:

~~~bash
tilework -invite admin       # print a new invite path (bootstrap the first production administrator)
tilework -backup out.db      # consistent online backup of the SQLite database
tilework -healthcheck        # exit 0 if /readyz answers (used by the container health check)
~~~
