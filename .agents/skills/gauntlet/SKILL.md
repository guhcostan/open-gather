---
name: gauntlet
description: The build-and-critique loop every change in this repo goes through. Use for any feature, fix, refactor or review in tilework, and when asked to review, critique or verify work.
---

# Gauntlet

Build against a written target, then let independent critics try to break it, until the stop condition holds. Why, and where the pattern comes from: [docs/gauntlet.md](../../../docs/gauntlet.md).

## Round 0: the brief

Write `.gauntlet/<slug>.md` (git-ignored) before touching code:

- **Target**: the user's words, then **acceptance criteria as observable behaviour**: what a person sees or a test measures ("the pet walks the owner's trail ~20 px behind and never cuts a corner"), never "works" or "looks good".
- **Baseline**: `git rev-parse HEAD`.
- **Seams**: the Go test, browser scenario or capture that will observe each criterion.

Done when every criterion names its seam.

## Each round

1. **Red.** For behaviour changes, write or extend the check at each seam and run it on the baseline. It must go red for the reason in the brief. Sharpen checks that pass despite the bug. For review-only, documentation or behaviour-preserving refactors, record the baseline checks and the applicable review evidence instead of manufacturing a failing test. Use a diagnosis loop for bugs: reproduce, narrow the cause, and verify the fix at that seam.
2. **Build** the smallest change that turns the checks green.
3. **Gates.** `scripts/gauntlet.sh <scenarios>` until it prints `GATES GREEN`. It records the run in `.gauntlet/last-gates.log` with the commit and a hash of the working tree; any edit after that makes the record stale.
4. **Critics.** Dispatch each critic in [critics/](critics/) as a subagent with a fresh context: give it the target and acceptance criteria from the brief, the baseline, `git diff <baseline>` and `.gauntlet/last-gates.log`. Let it inspect source and raw captures; keep builder conclusions out of its initial prompt. Without available subagents, run separate review passes and explicitly label them self-review, since context independence cannot be recreated inside one session. Critics read and run; they never edit. Only one of them may run the browser at a time (port 18080).
5. **Triage.** Keep a finding only with severity (blocker / major / minor), `file:line`, a reproduction and the check that would catch it. Append kept findings to the brief. Blockers and majors go to the next round as new red checks; minors are fixed or listed as known.

## Stop

- **Done**: gates green on the **whole** suite (`scripts/gauntlet.sh` with no arguments), no blocker or major open, and every acceptance criterion has evidence you ran this round.
- **Out of budget**: after 5 rounds, stop and report what is still red. Never call that done.

## Hand-off

Report per criterion: the evidence (command and result, or the capture you looked at), the findings fixed, the minors left, and what was not run. Update `docs/status.md`, the README status table and an ADR when behaviour or architecture changed (AGENTS.md, definition of done).
