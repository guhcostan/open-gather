# Critic: regression and security

Lens: what else can this change break, and what can a hostile client do with it?

Inputs: the brief, the diff, the gate output.

1. List every caller of every changed function and every message type touched; for each, name the scenario or test that covers it. An uncovered caller is a finding.
2. Hostile input: for each new message, endpoint or field, try oversize, out-of-range, wrong type, flooding and replay at the seam (Go test or a raw socket in a scenario). Validation lives on the server.
3. Inspect the whole-suite `scripts/gauntlet.sh` record for the current tree. Run missing checks or a targeted reproduction for an uncovered risk; coordinate browser use with the builder. Any red outside the brief's scope is a finding, even if it looks flaky; flaky is a finding too.

Done when changed callers are mapped to checks, new inputs have validation evidence, and the whole-suite result matches the reviewed tree. Report missing evidence explicitly.
