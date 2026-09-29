# Status and roadmap

Open Gather is at **MVP / alpha** level. This page separates what has been run from what has not. Last updated on 2026-09-29.

## Verified (executed)

Environment: macOS (Apple M1 Pro, arm64), Go 1.26.5, Google Chrome with fake camera and microphone, LiveKit 1.13.7. Real-browser scenarios run against a **real LiveKit server**.

| Check | What it proves |
| --- | --- |
| Go tests (`server/`, also with `-race`): world rules, dead reckoning, map reload, chat history, store (sessions, invites with a 40-way race, chat pruning, backup), media tokens and reconciliation | rules and invariants hold; media revocation is retried |
| Browser scenario `proximity` | movement sync, remote avatars tracked within a few pixels, a call forms ~1.6 s after approaching with **real audio and video RTP**, leaving revokes the SFU and stops capture |
| `consent` | nothing without opt-in; busy blocks automatic entry and leaves calls; invisible hides the avatar |
| `rooms` | admin-only room enforced by the server against raw inputs; tokens are scoped to one room; screen share is received; leaving a private room revokes access |
| `access` | only admins mint invites; invite use limits; production refuses insecure configuration; CLI invite and online backup |
| `editor` | real UI clicks paint walls and create a room; others get it live; the server enforces it; it persists across a restart |
| `social` | office/direct/conversation chat scopes and privacy, rate limit, 500-character cut, persisted office history, profile change, desk owner label |
| `security` | replayed (evicted by the reconciler), edited (rejected) and expired (rejected) media tokens |
| `resilience` | WebSocket drop keeps position, call and audio; flooding cannot speed a player up; oversized frames close the socket; session and position survive a server restart |
| Docker | image builds (24 MB, non-root); the local Compose stack passes `proximity`, `consent` and `rooms`; in the container, production mode returns 403 without an invite, issues a Secure cookie with one, and refuses insecure configuration |

The exact pass counts of the last full run are in the commit history; rerun `cd e2e && node run.mjs` to reproduce.

## Measured (local reference, not a capacity claim)

Scenario A (no media) up to 1,000 bots and a 500-client reconnect storm, with the generator on the same laptop: see [Benchmark results](benchmark-results.md). Highlights: state-change records cut server output about 5x and brought the worst tick at 1,000 concentrated bots from 143 ms to 60 ms; a 500-client mass reconnect finished in 2.0 s with no failures.

## Not run / not implemented

- **Scenarios B, C, D** (media under load) and TURN through restrictive networks.
- **The 2 vCPU / 4 GB reference server** and a load generator on a separate machine. A two-hour soak (a shorter one was started and stopped; no result is claimed).
- **Browser FPS/CPU** on the reference laptop.
- **The production Compose file with Caddy, real TLS and TURN on a public host.**
- No UI to list or revoke invites, change roles or remove members; no moderation or audit log.
- **Cost numbers:** only the formula and `bench/cost.py` exist; no prices were verified.
- Internationalisation beyond the pt-BR dictionary mechanism; accessibility audit.
- The new `security` scenario and the media reconciler were written last and their first full end-to-end run is still pending; unit tests for them pass.

## Roadmap

1. Architecture, decisions, repository, local environment. **Done.**
2. First functional slice with real proximity audio/video. **Done.**
3. Invites, presence, chat, persistence. **Done** (see limitations above).
4. Rooms, screen sharing, personalisation, basic editor. **Done.**
5. Benchmarks and evidence-driven optimisation. **Started:** scenario A and one optimisation done; media scenarios pending.
6. Reproducible self-hosted install and documentation. **Started:** Docker verified locally; production host untested.

Deferred on purpose: recording, AI transcription, native apps, marketplace, enterprise integrations and 3D worlds.
