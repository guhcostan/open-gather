# 0007 · Invites, roles, profile and map editing

- **Status:** accepted (2026-09-29)

## Context

A deployment needs a way to admit people, tell administrators from members, let administrators shape the office, and keep all of it enforceable on the server.

## Decision

- **One office per deployment** (`TILEWORK_OFFICE_SLUG`). Creating an office is installing the stack; multi-office hosting is deliberately left for later.
- **Invites:** random 192-bit tokens, only the SHA-256 is stored, with a role (`member` or `admin`), a use limit (1-1000) and a validity (at most 90 days). Spending an invite is one atomic `UPDATE ... RETURNING`, so concurrent joins cannot exceed the limit (tested with 40 racing requests). In production `/api/join` requires an invite; in `dev` it also works without one and the first member becomes administrator. The first production administrator is created with `tilework -invite admin`.
- **Roles come from the database session, never from the client.** Admin-only endpoints (`POST /api/invites`, `PUT /api/map`) check the role on the server; room access rules (`open`, `members`, `admins`, `list`) are enforced by the world when moving and by token issuing.
- **Map editing:** an administrator replaces the whole map. The server validates and compiles it (bounds, types, limits, spawn not inside a wall), hot-swaps it into the running world and only then saves it. The map size cannot change at runtime. On swap, room calls are dissolved (area indexes may change) and players standing inside a new wall are moved to the spawn.
- **Profile:** members change their own name and avatar (`PUT /api/profile`); the change reaches the roster live.
- **Chat retention:** office-wide chat keeps the last 500 messages in SQLite and replays 100 on connect. Direct messages and conversation chat are never stored.

## Consequences

- Install: production cannot be used until the first invite is minted, which is intentional.
- Security: rate limits on join, map and profile endpoints; bodies are size-limited.
- Invite listing/revocation, role changes and member removal were added later, see [0009](0009-administration-and-accessibility.md).
- Known gaps: an edit that fails to save after being applied is reported to the administrator but not rolled back in memory.
