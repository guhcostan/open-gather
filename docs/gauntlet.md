# The gauntlet loop

How changes are built and reviewed in this repository. Every change, by a person or an agent, runs it before it is called done. The procedure for agents lives in [`.agents/skills/gauntlet/SKILL.md`](https://github.com/guhcostan/tilework/blob/main/.agents/skills/gauntlet/SKILL.md); this page is the why.

## What it is

A gauntlet loop separates **building** from **judging**. A builder implements against a written target; critics inspect the result; the builder addresses supported findings and repeats. Research checked on 2026-10-01:

- [RoboNuggets, by Jay E, crediting Matt Shumer's technique](https://github.com/robonuggets/gauntlet-loop): separate critics with fresh context and blind comparison against a named, accessible reference. Its stopping rule is winning the comparison or user interruption.
- [kamtS/gauntlet-loop](https://github.com/kamtS/gauntlet-loop/blob/main/SKILL.md): bounded worker/critic passes, evidence-backed verdicts and an integration review; its runtime implementation routes workers and critics to different clients.
- [Anthropic's evaluator-optimizer pattern](https://www.anthropic.com/engineering/building-effective-agents): generation and evaluation repeat with feedback when criteria are clear and iterative improvement is useful.

Our local skill is an original, repository-specific procedure informed by these patterns; no external skill code was copied. We use acceptance tests rather than mandatory blind comparison, a maximum of five rounds, and read-only critics. These are local choices, not requirements shared by all gauntlet implementations.

Risks we address in this repository:

| Failure mode | Answer here |
| --- | --- |
| **False independence** | fresh-context critics receive acceptance criteria and raw evidence; fallback passes are labelled self-review |
| **Weak acceptance metrics** | criteria describe observable behaviour; bug regressions are seen **red** first |
| **Invented findings**: a critic told to find problems finds some | a finding needs severity, `file:line`, a reproduction and the check that would catch it, or it is dropped |
| **Regressions across rounds** | record the baseline and run the whole suite at completion |
| **Review side effects** | critics are read-only; mutations follow the AGENTS.md rules and the user's authorization |

## Why this repository needs it

Two bugs from 2026-10-01 shaped it:

- **The pet passed its test and still felt wrong.** The test checked "the pet ends up within 24 px of its owner", which is exactly what a glued, corner-cutting pet does. The fix started from observable criteria (follow the owner's trail ~20 px behind, never cut a corner, never outrun a walker, rest behind and not on top), a frame-by-frame recorder that went red on all four, and a **UX critic** that looked at a captured contact sheet. Metrics alone had already approved the bad pet once.
- **Sending a chat message blanked the whole app.** An effect returned `scrollIntoView()`'s value, which Chrome 154 turned into a Promise; React called it as a cleanup and unmounted everything. The browser suite sent chat through the API and never with the panel open. The fix added a real-UI regression check and a static rule in `scripts/lint-web.mjs`, so this bug class is now a gate.

## Gates

`scripts/gauntlet.sh` runs formatting, Go vet/race tests, client and test typechecks, the client build, web lint, pure game-logic tests, the docs build and the browser suite with the CI viewport (`CI=1`). Pass scenario names to run only those; the final round runs the whole suite. `GAUNTLET_SKIP_E2E=1` reports a partial static result, never completion. A log in `.gauntlet/last-gates.log` records the tree fingerprint and detects edits during the run.

## Critics

| Critic | Lens | Evidence it must produce |
| --- | --- | --- |
| **UX** | does it *feel* right: motion, timing, layout at 800x450 and on a phone, overlap with other UI | frames or a contact sheet (see `e2e/scenarios/capture-*.mjs`), viewed, plus the scenario run |
| **Invariants** | the AGENTS.md invariants: authoritative server, no per-frame sends, bounded queues, no content in logs, consent, audit, i18n, a11y | the `file:line` that breaks one, and the test that would catch it |
| **Regression and security** | what else this change can break; input validation, token scope, rate limits | a failing command |

## Limits

The loop reviews the requested change; it is not proof that the entire repository is defect-free. A critic verdict complements executed checks. Performance and capacity claims still need their own recorded measurements.
