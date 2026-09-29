# Privacy and security

This page states what the current code does and, just as important, what it does **not** do yet.

## Implemented

- **Consent gate**: media capture only starts after an explicit opt-in and never for people whose status is not *Available*.
- **Server-side room access**: meeting rooms have access rules (open, members, admins, list). The world server refuses to move a player into a room they cannot use, and only issues a media token for the room the player is legitimately in.
- **Scoped, short-lived media tokens**: one room, one identity, publish limited to microphone/camera/screen share, data channels off, valid 5 minutes.
- **Revocation on leave**: when someone leaves a group, the server asks the SFU to remove them from that room. Verified end to end: the SFU room was empty afterwards.
- **Sessions**: opaque random tokens; only a SHA-256 hash is stored. The cookie is HttpOnly, SameSite=Lax and Secure outside dev mode.
- **Input validation**: WebSocket frames are size- and rate-limited; avatars are re-serialised from validated fields; maps are validated (bounds, types, limits) before being accepted.
- **Production guard rails**: `OG_ENV=production` refuses to start without a real LiveKit key and secret (at least 32 characters), a `wss://` media URL and an explicit allowed-origins list, and it disables the dev join endpoint.
- **Logs**: structured JSON. Chat content and secrets are not logged.

## Not implemented or not verified yet

- **Invites and access control for joining an office.** Only the dev join endpoint exists, so a production deployment cannot onboard users yet.
- **Admin actions** (map editor, desk assignment, role changes) and their authorisation tests.
- **Token replay window.** Tokens cannot be revoked in LiveKit; a former room member who kept a token could reconnect until it expires (5 minutes). Planned mitigations: shorter tokens and periodic reconciliation that removes anyone in an SFU room who is not in the matching group. **An unauthorised subscription attempt has not been tested yet.**
- **Rate limiting of media token requests** and abuse handling.
- **TURN and ICE configuration** tested with restrictive networks.
- Independent security review.

Do not deploy this as a multi-tenant or public service until those items are done.

## Reporting a vulnerability

Please open a private security advisory on the GitHub repository instead of a public issue.
