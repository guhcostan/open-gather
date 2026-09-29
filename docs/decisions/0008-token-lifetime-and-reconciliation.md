# 0008 · Short media tokens and SFU reconciliation

- **Status:** accepted (2026-09-29). Replaces the 5-minute token lifetime of [0003](0003-media-rooms.md) and closes the "token replay window" listed in earlier status notes.

## Context

LiveKit tokens cannot be revoked. Removing a participant from a room does not stop them from connecting again with the same token until it expires, so a leaked or replayed token would give access after the person had left the group.

## Decision

1. Join tokens are valid for **30 seconds** by default (`OG_MEDIA_TOKEN_TTL_SECONDS`). LiveKit's JWT library adds **60 s of clock-skew leeway** (measured in the security test: a token 12 s past its expiry was still accepted), so the effective lifetime is up to 90 s. A token is only needed to *connect*; clients that lose the media connection ask the server for a new one (`tok`).
2. A **reconciler** runs every **10 seconds** (`OG_MEDIA_RECONCILE_SECONDS`). It lists the SFU rooms of the office, then asks the world which identities belong to which room, and removes everybody else. The SFU is listed first and the world snapshot taken second, so a person who joined legitimately in between is never removed by mistake.
3. Room names carry a per-installation random prefix (`<instance>.o<office>.…`), and the reconciler only looks at rooms with its own prefix. Without this, two app servers sharing one LiveKit (for example a dev stack and a test run) would evict each other's participants.
4. Leaving a group still removes the participant immediately (with retries); the reconciler is the safety net.

## Impact

- A replayed, unexpired token can connect, but is evicted within one reconcile interval. This is tested against a real LiveKit server (the test uses 20 s tokens and a 3 s interval to keep the run short).
- Edited tokens are rejected by the SFU (signature), and tokens fail to connect once expiry plus the 60 s leeway has passed.
- Cost: one `ListRooms` call plus one `ListParticipants` call per active room every 10 s; negligible next to media traffic, but proportional to the number of active rooms.

## Not solved

Up to one reconcile interval of exposure remains for a replayed token, and the reconciler only compares identities: two connections with the same identity in one room are handled by the SFU (the newer replaces the older).
