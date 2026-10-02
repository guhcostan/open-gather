# 0011 · Public demo mode

- **Status:** accepted (2026-09-30)

## Context

People should be able to try Tilework without asking for an invite, then self-host it from the repository or the Docker image. A public instance cannot keep production's invite-only rule, but it must not hand out administrator rights or keep growing user-written content forever.

## Decision

- `TILEWORK_DEMO=1` (only meaningful with `TILEWORK_ENV=production`, whose guard rails stay on) lets `/api/join` succeed without an invite. Demo joins are **always** forced to the member role: the store's rule that the first member of an empty office becomes admin does not apply to them. Invites keep working, so the operator bootstraps an administrator with the CLI.
- Anonymous demo sign-ups use their own per-IP limiter (0.2/s, burst 5), separate from `TILEWORK_JOIN_RATE`.
- Every `TILEWORK_DEMO_RESET_HOURS` (default 6) on wall-clock boundaries, the server restores the starter map, deletes the office chat history and every whiteboard in one transaction, then applies the same to the running world (map hot-swap, open boards closed, chat history cleared). Members and sessions are kept; the reset is audited as `demo.reset`.
- `/api/me` returns `demo: {resetHours, nextReset}` so the client can warn visitors on the join screen and in the top bar.

## Consequences

- Performance: none on the hot path; one timer and one transaction per reset period.
- Maintenance: new persisted, user-written content types must be added to `ResetDemoContent`.
- Install: two new optional variables in `deploy/.env` (`DEMO`, `DEMO_RESET_HOURS`).
- Limits: users and memberships accumulate between resets (sessions expire after `SESSION_DAYS`); there is no CAPTCHA, so a determined abuser can still create many accounts slowly; direct and conversation chat are never stored, so a reset does not need to touch them.
