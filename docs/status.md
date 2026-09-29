# Status and roadmap

Open Gather is **alpha**. This page separates what has been verified from what has not. Last updated on 2026-09-29.

## Verified

Executed on macOS (Apple M1 Pro, arm64), Go 1.26.5, Google Chrome with fake camera and microphone devices, LiveKit 1.13.7 in dev mode on localhost.

| Check | Result |
| --- | --- |
| Go unit tests for the world (collisions, speed enforcement, room access rules, area of interest, proximity formation and revocation, busy and no-consent, chains of avatars, standing between groups, meeting-room isolation, slow-client backpressure), also with the race detector | 10/10 pass |
| End-to-end smoke test with two real Chrome instances | 15/15 checks pass |

What the smoke test proves: both users connect; the roster shows both; each sees the other's avatar; movement is synchronised; a proximity conversation forms about 1.4 to 1.6 s after approaching; the SFU room contains exactly both identities; **real audio and video RTP bytes are received**; moving away ends the conversation; the server revokes access for both; the SFU room is empty; local capture stops; no browser console errors.

This is a functional check on one machine, **not** a capacity or network-quality measurement.

## Implemented, not yet verified end to end

Screen sharing, office chat and direct messages, status handling in the browser, device selection and error handling, economy mode, reconnection, persistence across restarts.

## Not implemented yet

- Invites and access control for joining an office; production onboarding.
- Admin map editor, desk assignment and personalisation.
- Docker Compose and a production LiveKit configuration; backup and restore documentation.
- Load generators, benchmarks and cost tables.
- Private-room isolation tests, including an unauthorised subscription attempt.
- Internationalisation beyond the base dictionary mechanism.

## Roadmap

1. Architecture, decisions, repository and local environment. **Done.**
2. First functional slice: two browsers, synchronised avatars, real proximity conversation. **Done, see "Verified".**
3. Authentication, invites, presence, chat and persistence. **Next.**
4. Rooms, screen sharing, personalisation and a basic editor.
5. Benchmarks, bottleneck analysis and evidence-driven optimisation.
6. Reproducible self-hosted installation and final documentation.

Deferred on purpose: recording, AI transcription, native apps, marketplace, enterprise integrations and 3D worlds.
