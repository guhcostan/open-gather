# Privacy and security

This page states what the current code does and, just as important, what it does **not** do. "Tested" means an automated check exists and was run; see [Status](status.md) for the counts.

## Implemented and tested

- **Consent gate:** media capture only starts after an explicit opt-in and never for people whose status is not *Available*. Leaving a conversation stops local capture. (Browser test.)
- **Server-side room access:** meeting rooms have access rules (open, members, admins, list). The world refuses to move a player into a room they cannot use and only issues a media token for the room the player is legitimately in. Bypassing the client with raw inputs does not help. (Browser and unit tests.)
- **Scoped, short-lived media tokens:** one room, one identity, publish limited to microphone/camera/screen share, data channels off, **valid 60 seconds** ([decision 0008](0008-token-lifetime-and-reconciliation.md)). (Unit and browser tests decode the token.)
- **Revocation and reconciliation:** leaving a group removes the participant from the SFU at once (with retries), and a reconciler removes any SFU participant the server does not consider a member every 10 s. Replayed, edited and expired tokens were tried against a real LiveKit server. (Browser test.)
- **Invites and roles:** hashed, use-limited, expiring invites; administrator-only invite and map endpoints; production joins require an invite. (Store, HTTP and browser tests.)
- **Sessions:** opaque random tokens, only a SHA-256 hash is stored; the cookie is HttpOnly, SameSite=Lax and Secure outside dev mode.
- **Input validation:** WebSocket frames are size- and rate-limited; avatars are re-serialised from validated fields; names are bounded; maps are validated and compiled before being accepted; request bodies are size-limited.
- **Production guard rails:** `OG_ENV=production` refuses to start without a real LiveKit key and a secret of at least 32 characters, a `wss://` media URL and an explicit allowed-origins list. Verified with the built container image.
- **Logs:** structured JSON. Chat text, tokens and secrets are not logged (invite creation logs who and how many uses, never the token).

## What is stored

| Data | Where | Retention |
| --- | --- | --- |
| Names, avatars, roles, last position | SQLite | until the database is deleted |
| Sessions and invites | SQLite, **hashed** | until expiry |
| **Office chat** | SQLite | last 500 messages per office; 100 replayed on connect |
| Direct and conversation chat | memory only, never stored | gone when delivered |
| Audio, video, screen share | not recorded; only flows through the SFU | none |

## Not implemented or not verified

- **TURN and ICE** behaviour behind restrictive firewalls and NATs. TURN over TLS on port 443 is not configured. Documented in [deploy/README.md](../deploy/README.md), not tested.
- **Up to one reconcile interval (10 s) of exposure** remains for a replayed, unexpired token.
- **Invite management UI**, role changes and member removal do not exist yet; rotate by expiring invites.
- **Abuse handling:** rate limits exist, but there is no moderation, blocklist or audit log.
- **`/metrics` has no authentication.** The provided Caddyfile hides it from the public hostname; keep it that way.
- **No independent security review.** Do not run this as a multi-tenant or public service.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository instead of a public issue.
