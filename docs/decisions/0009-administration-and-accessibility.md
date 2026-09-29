# 0009 · Administration, audit trail, /metrics policy and accessibility checks

- **Status:** accepted (2026-09-29)

## Context

Decision [0007](0007-invites-roles-and-map-editing.md) let administrators mint invites and edit the map, but they could not see or revoke invites, change a role, remove a member, or find out who did what. `/metrics` was open to anyone who could reach the port, and accessibility had never been checked.

## Decision

- **Members:** `GET/PATCH/DELETE /api/admin/members`. A role lives in the database and is read when the socket joins, so a role change **evicts** the member (close code 4003, the world removes the player and revokes any call) and the client reconnects at once with the new role. Removal deletes the membership and every session of that user in that office and evicts the socket; the user row stays so old chat lines and audit entries keep a name. The last administrator cannot be demoted or removed, and nobody can remove themselves (enforced in one transaction, tested with unit and browser tests).
- **Invites:** `GET /api/admin/invites` lists id, role, uses, expiry, creator and a derived status (active, expired, used up, revoked); the secret is never returned again because only its hash is stored. `DELETE` revokes.
- **Audit trail:** table `audit_log` (migration 005) with actor, action, target name and a short detail. It records joins by invite, role changes, removals, invite creation and revocation and map edits. It never stores message content, is pruned to 2,000 entries per office, and writing it can never block or fail the action (a failure is logged).
- **Deterministic close codes:** the kick callback now runs on the world goroutine right before the outbound channel closes and only records a reason; the socket writer sends 4001, 4002 or 4003 accordingly. Before, a race between the writer's generic close and the asynchronous kick could hide the reason.
- **`/metrics`:** bearer token `OG_METRICS_TOKEN` (at least 16 characters). Open in dev without one; disabled (404) in production without one. A loopback-only rule was rejected because a reverse proxy on the same host would make every request look local.
- **Accessibility:** dialogs trap focus and close with Escape, controls have accessible names, tables have headers, the status menu is a plain disclosure list, the map carries a text label, and an **axe-core** scenario (`e2e/scenarios/a11y.mjs`, WCAG 2.1 A/AA plus axe best-practice rules) audits every screen and dialog in a real browser. axe-core is MPL-2.0 and used only by the tests.

## Consequences

- **Performance:** none on the hot path. Admin calls are rate limited (5/s per admin) and touch SQLite only.
- **Maintenance:** one more table and migration; new admin actions must call `audit` and, if they change a member's access, `evict`.
- **Install:** production deployments should set `METRICS_TOKEN` if they scrape `/metrics`.
- **Limits, stated plainly:** no ban list (a removed person can rejoin with any valid invite), no temporary mute or kick, no reporting flow. The audit log is not tamper-proof. The automated audit finds a subset of accessibility problems; the game canvas itself is not operable with a screen reader, and no one has tested with NVDA, VoiceOver or JAWS.
