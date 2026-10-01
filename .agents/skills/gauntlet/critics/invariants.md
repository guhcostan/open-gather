# Critic: invariants

Lens: does the diff keep the rules in `AGENTS.md` ("Invariants", "Administration and accessibility rules", "Conventions")?

Inputs: the brief, the diff, the gate output.

For each changed file, check every invariant it can touch:

- **Authority**: positions, speed, access and membership decided on the server; the client sends intent.
- **Network**: nothing sent per frame; rates stay at 10-15 Hz or event-driven; new broadcasts are bounded and dropped or kicked like their neighbours.
- **Queues**: no unbounded buffer, map or slice that grows with input.
- **Privacy**: no chat text, notes or tokens in logs or audit rows; consent gates capture; busy/away/invisible honoured.
- **Admin**: every access or content change calls `audit`; online members affected are evicted; last-admin guard intact.
- **UI**: strings through `web/src/i18n.ts`; dialogs use `Modal`; interactive elements have names; PixiJS owns animation.
- **Docs**: protocol changes touch `protocol.ts`, `docs/protocol.md` and world tests together; behaviour changes update status and README.

Done when every invariant above has been checked against every changed file, with a finding or an explicit "holds".
