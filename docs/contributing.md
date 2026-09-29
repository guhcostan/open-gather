# Contributing

Thanks for looking. The project is early, so the most useful contributions are careful bug reports, tests and measurements.

## Ground rules

- **English everywhere**: code, comments, commit messages, documentation and issues.
- **Original work only**: do not copy code, maps, sprites or branding from Gather or any proprietary product. Any third-party asset or dependency must have a compatible licence and be listed.
- **License**: contributions are accepted under **AGPL-3.0**, with no additional restrictions on commercial use.
- **Evidence over claims**: do not describe a number as "capacity" unless it was measured, with the environment recorded. Keep measured results, estimates and not-run tests clearly separated.

## Development loop

~~~bash
./scripts/dev.sh                 # full local stack
cd server && go test -race ./... # server tests
cd web && pnpm exec tsc --noEmit # type-check the client
cd e2e && node smoke.mjs         # real-browser smoke test (stack must be running)
~~~

## Invariants worth protecting

1. The server is authoritative; the client sends intent.
2. Never persist movement per step; never send movement per frame.
3. Media authorisation is enforced by the server/SFU. Hiding or muting a video in the UI is not isolation.
4. Every user-visible string goes through the i18n dictionary.
5. Do not log chat content or secrets.
6. Local development and production configuration must stay clearly distinct.

## Pull requests

Keep them focused, include tests for behaviour changes, and update the docs in the same PR. Describe exactly what you ran and what you did not.
