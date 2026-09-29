# 0004 · JSON WebSocket protocol

- **Status:** accepted (2026-09-29), to be revisited with benchmarks

## Decision

Text JSON messages with short field names. A binary format only enters if measurement shows a benefit.

Optimisations already applied, all independent of the wire format:

- client input is sent only when the direction changes (plus a resend every 400 ms while a key is held);
- deltas are batched per client, one frame per tick;
- positions are integers in pixels;
- WebSocket compression is disabled (it costs CPU and memory per connection);
- a 2 KB cap per incoming frame and per-connection rate limits.

## Consequences

Debugging is easy (traffic is readable in the browser). The cost is bandwidth and serialisation CPU above a binary format; how much that matters is a question for the presence benchmark (scenario A).
