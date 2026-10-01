# 0014 · Evidence-based review and cosmetic pet trails

- **Status:** accepted (2026-10-01)

## Context

Pet checks accepted an animation that stayed too close and cut corners. Chat checks sent through the API, missing a React effect cleanup crash when the visible panel received messages. Review also exposed chat controls covered by overlays at smaller viewports.

## Decision

Use a repo-local gauntlet skill, linked from AGENTS.md: write acceptance criteria, reproduce behaviour failures, implement, run automatic gates, and ask fresh-context read-only critics to inspect results. Stop with evidence or report remaining failures after five rounds. Self-review fallbacks are identified explicitly. The gate script records its tree fingerprint and skipped checks.

Move cosmetic pet following into pure TypeScript logic. Keep a short owner trail, target a point 20 px along it, and adjust speed for network corrections. Large teleports reseed the trail. After a stationary owner hides the pet, the pet strolls toward an available side spot. WorldView owns animation and supplies the static collision query for choosing that spot; the pet adds no server or network state.

Chat scrolling effects return nothing. Regression tests type through the actual composer with panels open and hit-test controls at desktop and phone sizes. Layering keeps the panel usable while preserving editor and status-menu access.

## Consequences

- Performance: bounded trail storage per visible pet; no per-frame network traffic, persistence or React updates. No new capacity measurement was made.
- Maintenance: pure pet tests cover corrections, running, low frame rates and resting visibility; real-browser scenarios cover chat and observer animation. Regex lint catches selected hook mistakes, not every possible misuse.
- Install: no runtime dependency or server change. Node 24 runs the TypeScript tests; @types/node is development-only. Review prompts and scripts live in the repo, without globally installing skills.
- Limits: depth ordering can briefly hide the pet while walking toward the camera; corner turns can produce brief shoulder overlap. The cosmetic pet does not run a full pathfinder. Public demo behaviour requires a separate deployed-revision check.
