# AGENTS.md

Guidance for AI coding agents (and humans) working in this repository. Read it fully before changing anything.

## What this project is

**Open Gather** (provisional name) is an open source 2D virtual office inspired by the classic Gather experience: pixel-art avatars, proximity audio/video, meeting rooms, chat, screen sharing. Its differentiator is **efficiency** in CPU, RAM, GPU and bandwidth, on the browser and on the server, so it can run on cheap infrastructure with capacity that is **measured and documented**.

It is **not** affiliated with the original Gather product. Never copy its brand, maps, sprites or code.

## Language rule

**Everything is in English**: code, comments, identifiers, commit messages, PR text, issues, README, docs, site copy, error messages and generated art text. (The player-facing UI is English, the only shipped locale, and goes through the i18n dictionary in `web/src/i18n.ts`; new user-visible strings must go there, never inline.)

## Repository map

| Path | What lives there |
| --- | --- |
| `server/cmd/opengather` | entry point |
| `server/internal/world` | authoritative simulation: movement, spatial grid, areas of interest, proximity groups, backpressure, stats |
| `server/internal/gamemap` | map format, validation, collision grids, default office |
| `server/internal/media` | LiveKit access tokens and participant removal |
| `server/internal/store` | SQLite (WAL), embedded migrations, sessions |
| `server/internal/httpapi` | routes, WebSocket session, rate limits, Prometheus metrics |
| `server/internal/config` | environment configuration and production guard rails |
| `web/src/game` | PixiJS world (`WorldView.ts`), avatar textures, map texture |
| `web/src/game/art` | pure-canvas painters: `pixel.ts` helpers, `tiles.ts` floors/walls/props/map baker, `characters.ts` sprites |
| `web/src/theme-gba.css` | dialog-window UI skin layered over `styles.css` |
| `web/dev` | server-free art preview page and its map fixture |
| `web/src/media` | LiveKit room management |
| `web/src/ui` | React UI (panels, dialogs) |
| `web/src/session.ts` | glue between socket, world view, media and store |
| `e2e/` | real-browser test suite (`run.mjs` + `scenarios/`) and art generation |
| `bench/`, `server/cmd/loadgen`, `scripts/bench.sh` | benchmarks: scripts, raw results, WebSocket load generator, cost model |
| `deploy/` | Dockerfile, Compose (local and production), Caddyfile, production README |
| `site/` | landing page and docs generator (GitHub Pages) |
| `docs/` | documentation sources (`docs/decisions/` holds ADRs) |

## Commands

~~~bash
./scripts/dev.sh                          # LiveKit (dev) + Go server + Vite; logs in .run/
cd server && go vet ./... && go test -race ./...
cd web && pnpm exec tsc --noEmit && pnpm exec vite build
cd e2e && node run.mjs                    # real Chrome + real LiveKit; builds, starts its own server with a fresh database
cd e2e && OG_EXTERNAL_URL=http://127.0.0.1:8080 node run.mjs   # same scenarios against a running stack (e.g. Docker Compose)
cd site && pnpm install && node build.mjs # builds site/dist
~~~

Art (output goes to `site/assets/`; details in `docs/art-style.md`):

- Preview: `cd web && pnpm exec vite --port 5180`, then open `/dev/art-preview.html?s=8`.
- `e2e/export-art.mjs`: sprite sheets and the baked map from the art code (needs only the Vite preview).
- `e2e/art.mjs`: cast, walking GIF and banner. Standalone (Chrome + ffmpeg only).
- `e2e/screens.mjs`: clean in-game screenshots; needs a game server serving the built client.

## Invariants: do not break these

1. **The server is authoritative.** Clients send intent (direction), never positions. Collisions, speed, room access and conversation membership are decided on the server.
2. **Never persist movement per step and never send movement per frame.** Network rate is 10-15 Hz, batched. Only the last position is saved, when a player leaves.
3. **Spatial index and areas of interest.** Do not introduce all-pairs comparisons in the tick or the proximity pass.
4. **Backpressure.** Queues are bounded. Stale positions are dropped/overwritten for slow clients; reliable messages (chat, control) are not dropped silently. Do not add unbounded buffers.
5. **Media isolation is enforced by the server/SFU.** Hiding or muting a video in the UI is not isolation. Tokens are scoped to one room and one identity; leaving a group revokes access.
6. **Consent gates capture.** No camera or microphone access before an explicit opt-in; busy/away/invisible never join automatic conversations; leaving a conversation stops local capture.
7. **Animation stays out of React.** PixiJS owns the world and its ticker; React only renders UI.
8. **Local dev and production must stay clearly distinct.** Production mode must keep refusing insecure defaults.
9. **No content or secrets in logs.** Never log chat text, tokens, keys or secrets.
10. **Original assets only.** Any third-party asset or dependency needs a compatible licence and must be documented. The visual *style* may be inspired by 2000s handheld RPGs, but never use, trace, extract or recolour assets from Pokémon or any Nintendo/Game Freak (or other) game; draw everything in code under `web/src/game/art`.

## Conventions

- Go: standard library first, `gofmt`, table-driven tests where natural, no dependency for what a few lines do. Keep `internal/media` the only package that speaks to LiveKit.
- TypeScript: `strict` is on; keep `tsc --noEmit` clean. Prefer small modules; keep hot paths allocation-light.
- Validate all external input: WebSocket messages, avatars, maps, uploads. Enforce size and rate limits.
- Media tokens are short (30 s, LiveKit adds 60 s of leeway) and the reconciler in `httpapi` removes unknown SFU participants: keep both when touching `internal/media`.
- Protocol changes: update `web/src/net/protocol.ts`, `docs/protocol.md` and the world tests together.
- Add or update a decision record in `docs/decisions/` when you change an architectural choice, with the performance, maintenance and install impact.

## Evidence and honesty rules

This project reports **only what was actually run**.

- Keep **measured results**, **estimates** and **not-run tests** clearly separated. Label targets as targets.
- Never state a capacity ("supports N users") without a recorded measurement: hardware, region, OS, network limits, services, and where the load generator ran.
- A build, a screenshot or simulated data is not proof of behaviour. A WebSocket benchmark does not prove video capacity.
- When you finish work, say exactly what you executed and what remains pending. Update `docs/status.md` and the README status table together with the code.
- Do not invent prices; give a formula and assumptions.

## Working in a shared checkout

Other agents or people may be working in the same tree at the same time.

- Check `git status` before editing; do not revert or reformat files you did not touch, and never run destructive git commands (`reset --hard`, `checkout --`, `clean`) without an explicit request.
- Do not kill processes or free ports you did not start. Use your own database file (for example `OG_DB=server/data/<unique>.db`) instead of deleting shared ones.
- The dev stack listens on 5173 (Vite), 8080 (Go) and 7880 (LiveKit). Start long-running processes in a persistent session; they die with short-lived shells.

## Testing notes and gotchas

- The browser exposes `window.__og` (view, media, state, session) for tests. Drive movement with `view.setDirection`, not synthetic key events.
- LiveKit's client may use a single peer connection; read RTP stats from `room.engine.pcManager.subscriber?.pc ?? publisher.pc` (see `rtpBytes` in `e2e/lib.mjs`).
- Editing client files while the Vite dev server runs can trigger a full reload and break a running E2E script; rerun it.
- Avatar sheet cells are 18x26 px (16x24 content plus a 1 px outline margin). The outline is applied per cell so nothing bleeds between rows; keep it that way. `e2e/art.mjs` crops to 25 rows when it reuses cells.
- The camera uses integer zoom (`VIEW_REF_W/H` in `WorldView.ts`). Keep the server's area of interest large enough to cover the visible world at the smallest zoom.
- Tests that need real media use Chrome flags `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`.
- Load generators must run **outside** the machine being measured.

## The site (GitHub Pages)

`site/build.mjs` turns `docs/*.md`, `docs/decisions/*.md` and `site/src/landing.html` into `site/dist/` with relative links (it works under `/open-gather/`). The workflow in `.github/workflows/pages.yml` builds and deploys it on pushes to `main` that touch `site/` or `docs/`. To add a docs page: create the Markdown file in `docs/` and register it in the `NAV` list in `site/build.mjs`.

## Out of scope for now

Recording, AI transcription, native apps, marketplace, enterprise integrations and 3D worlds. Do not start them without an explicit request.

## Definition of done

- Code builds, is formatted, and relevant tests pass (state which you ran).
- Behaviour changes have tests; risky media/privacy changes have an end-to-end check or a clearly stated "not verified".
- Docs, decision records and the status table are updated in the same change.
- No secrets, no content logging, no new unbounded queues, no per-frame network sends.
