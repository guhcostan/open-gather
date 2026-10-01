# Status and roadmap

Open Gather is at **MVP / alpha** level. This page separates what has been run from what has not. Last updated on 2026-09-30.

## Verified (executed)

Environment: macOS (Apple M1 Pro, arm64), Go 1.26.5, Google Chrome with fake camera and microphone, LiveKit 1.13.7. Real-browser scenarios run against a **real LiveKit server**.

| Check | What it proves |
| --- | --- |
| Go tests (`server/`, also with `-race`): world rules, dead reckoning, map reload, chat history, store (sessions, invites with a 40-way race, chat pruning, backup, roles and the last-admin guard, member removal, invite revocation, audit trail), the admin HTTP API (403/401 for non-admins, role change, removal, invite lifecycle, /metrics policy), production configuration guard rails, eviction from the world, media tokens and reconciliation | rules and invariants hold; media revocation is retried |
| Browser scenario `proximity` | movement sync, remote avatars tracked within a few pixels, a call forms ~1.6 s after approaching with **real audio and video RTP**, leaving revokes the SFU and stops capture; a per-person volume button turns the other person to 50 % and to muted for the listener only |
| `consent` | nothing without opt-in; busy blocks automatic entry and leaves calls; invisible hides the avatar |
| `rooms` | admin-only room enforced by the server against raw inputs; tokens are scoped to one room; screen share is received; leaving a private room revokes access |
| `access` | only admins mint invites; invite use limits; production refuses insecure configuration; CLI invite and online backup |
| `editor` | real UI clicks paint walls and create a room; others get it live; the server enforces it; it persists across a restart |
| `social` | office/direct/conversation chat scopes and privacy, rate limit, 500-character cut, persisted office history, profile change, desk owner label |
| `admin` | through the real UI: members list, promote/demote an online member (evicted, reconnects with the new role), the last admin cannot be demoted, invite create/list/revoke (secret never listed, revoked link returns 403), activity log, removing a member sends them to the join screen with a notice and kills their session |
| `a11y` | axe-core (WCAG 2.1 A/AA + best-practice rules) reports zero violations on the join screen, people and chat panels, status menu, settings, administration (three tabs), consent dialog and the map editor; dialogs trap focus and close with Escape |
| `security` | replayed token connects but is evicted by the reconciler within seconds; edited token rejected; expired token rejected only after LiveKit's 60 s clock-skew tolerance (found by this test, now documented) |
| `resilience` | WebSocket drop keeps position, call and audio; flooding cannot speed a player up; oversized frames close the socket; session and position survive a server restart |
| `features` | keys 1-7 show reactions on both avatars; X opens a nearby note whose content is absent from the public map; follow walks around walls to the leader and stops on input; portals teleport once per arrival; a locked room blocks outsiders and admits one visitor after a knock; edited notes and whiteboards persist across a restart |
| `spotlight` | stepping on the pad with consent goes on air; a listener in a separate private call receives real audio, video and screen share RTP; audience tokens are subscribe-only and scoped; withdrawing consent or stepping off empties the SFU room |
| `movement` | walking measures 72 px/s and running (R / Shift) 144 px/s in the browser; another browser sees the run bit and agrees on where the runner stops (< 1 px); double-clicking the map runs there along a server path; "Walk to" in the people panel crosses the office around walls in ~3 s; a member cannot be routed into an admin-only room; pets picked on the join screen are stored, drawn next to their owner for others, trot after them, and change live through the profile; unknown pets are rejected |
| `rooms` (screen share) | besides isolation: the receiving browser expands the shared screen over the map (360 -> 1240 px) and shrinks it with Escape; the presenter's avatar shows a screen badge that clears when sharing stops; the capture runs at 1920x1080 |
| `presence` | a wave crosses the office (behind a wall, out of view) and "Walk to them" runs to the waver; busy people are not disturbed and the sender is told; H raises a hand others see over the avatar and in the roster, H again lowers it; a note typed in the status menu appears in the other person's people panel; Z dances for people nearby; the minimap shows server head counts and clicking it runs there; M hides it; on an emulated phone (390x844, touch) the on-screen pad walks the avatar; ? opens the shortcuts; an administrator announcement reaches both people as a banner that can be dismissed, and the activity log records it without the text |
| Docker | image builds (24 MB, non-root); the local Compose stack passes `proximity`, `consent` and `rooms`; in the container, production mode returns 403 without an invite, issues a Secure cookie with one, and refuses insecure configuration |
| Public demo on a real host (2026-09-30) | the production Compose file (Caddy + Open Gather + LiveKit 1.13.7) runs on an Oracle Cloud Always Free AMD micro VM (1 GB RAM + 2 GB swap, São Paulo) with `DEMO=1`; Caddy obtained Let's Encrypt certificates; LiveKit discovered and validated the public IP. `e2e/demo-smoke.mjs` from a laptop in São Paulo over the public internet: invite-less join as member, proximity call live, **real audio and video RTP received, over UDP** (selected ICE pair udp, RTT 10 ms). Demo-mode unit tests: no invite needed, never admin, per-IP sign-up limit, reset restores map and wipes chat and boards. On 2026-10-01 the demo was updated to the published image of commit a6a1e3a and, from the same laptop over the internet, the smoke test passed again (7/7, UDP, RTT 11 ms) and the `movement` scenario passed 14/14 against it (`OG_SHARED_OFFICE=1 OG_EXTERNAL_URL=...`): running at 144 px/s, walk-to, pets |

GitHub Actions (`.github/workflows/ci.yml`) runs the Go tests with `-race`, the web typecheck/build and this whole browser suite on an Ubuntu runner (software-rendered Chrome, real LiveKit); the run for the latest commit is green. The runner is much slower than a laptop (10-16 FPS), so the test walker steers frame by frame inside the page.

The exact pass counts of the last full run are in the commit history; rerun `cd e2e && node run.mjs` to reproduce.

## Measured (local reference, not a capacity claim)

Scenario A (no media) up to 1,000 bots and a 500-client reconnect storm, with the generator on the same laptop: see [Benchmark results](benchmark-results.md). Media through a real SFU (B, D and a scaled C, 0 % loss up to 40 people in calls, ~1.3-1.8 % of one M1 core per forwarded Mbit/s) is in the same document. Highlights: state-change records cut server output about 5x and brought the worst tick at 1,000 concentrated bots from 143 ms to 60 ms; a 500-client mass reconnect finished in 2.0 s with no failures.

## Not run / not implemented

- **Scenario C at its full size** (100 people in 25 calls) and any media test with the generator on another machine. B (20 people), a scaled C (40 people) and D (20-person meeting) were run locally with real synthetic media; 60 people and above saturate a single laptop. TURN through restrictive networks is untested.
- **The 2 vCPU / 4 GB reference server** and a load generator on a separate machine. A two-hour soak (only a 10-minute, 300-bot presence soak was run: flat goroutines/RSS, see benchmark-results.md).
- **Browser FPS/CPU on the reference laptop.** Measured only on an Apple M1 Pro: 59.9 FPS (normal) and 29.6 FPS (economy, capped) with 300 bots, see [Benchmark results](benchmark-results.md).
- **The production Compose file with Caddy, real TLS and TURN on a public host.**
- **Moderation is minimal:** admins can remove members and revoke invites, but there is no ban list, temporary mute, reporting flow or content moderation; the audit log is not tamper-proof.
- **Accessibility:** only the automated axe-core audit and keyboard checks were run. The game canvas is not operable with a screen reader and nobody has tested with NVDA, VoiceOver or JAWS.
- **Cost numbers:** only the formula and `bench/cost.py` exist; no prices were verified.
- Only English is shipped (the i18n dictionary mechanism exists for more locales).

## Roadmap

1. Architecture, decisions, repository, local environment. **Done.**
2. First functional slice with real proximity audio/video. **Done.**
3. Invites, presence, chat, persistence. **Done** (see limitations above).
4. Rooms, screen sharing, personalisation, basic editor. **Done.**
5. Benchmarks and evidence-driven optimisation. **Started:** scenario A and one optimisation done; media scenarios pending.
6. Reproducible self-hosted install and documentation. **Started:** the production Compose stack runs the public demo on a free Oracle VM (scripts in `deploy/oracle/`); multi-arch image published to GHCR. Not tested: TURN relay for UDP-blocked networks (the relay port range is closed on the demo host), load on the demo host.

Deferred on purpose: recording, AI transcription, native apps, marketplace, enterprise integrations and 3D worlds.
