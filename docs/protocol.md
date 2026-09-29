# WebSocket protocol

JSON text frames, short field names (see [decision 0004](0004-json-protocol.md)). The connection is authenticated by the session cookie. The server closes with code **4001** when a newer connection replaces the session and **4002** when a client is too slow.

Every connection starts with a full `hello`; the same happens on every reconnect, so the client never needs to merge state across connections.

## Client to server

| Message | Fields | Meaning |
| --- | --- | --- |
| `in` | `s` seq, `x`, `y` (-1, 0, 1) | movement intent; sent on change and every 400 ms while held |
| `st` | `v` | set status: `available`, `busy`, `away`, `invisible` |
| `consent` | `b` | opt in or out of automatic conversations |
| `chat` | `sc` (`o` office, `g` group, `d` direct), `text`, `id` (peer for `d`) | send a message |
| `loc` | `id` | ask where a person is |
| `tok` | none | request a fresh media token for the current conversation |
| `ping` | `c` | round-trip probe |

## Server to client

| Message | Fields | Meaning |
| --- | --- | --- |
| `hello` | `you`, `role`, `status`, `office`, `cfg`, `map`, `roster` | initial state |
| `w` | `k` tick, `m` [[id, x, y, d]...], `l` [id...] | positions in your area of interest, and entities that left it |
| `a` | `s`, `x`, `y` | acknowledgement with the authoritative position |
| `p` | `a` people added/updated, `d` ids removed | presence roster changes |
| `c` | `sc`, `f` from, `to`, `x` text, `ts` | chat message |
| `conv` | `op` = `join` / `m` / `leave` | conversation lifecycle, including the room name and token on `join` |
| `loc` | `id`, `ok`, `x`, `y`, `a` | answer to a locate request |
| `pong` | `c` | reply to `ping` |

In `w` entries, `d` packs the facing direction and movement: `direction * 2 + (moving ? 1 : 0)` with directions 0 down, 1 left, 2 right, 3 up.

## Limits

| Limit | Value |
| --- | --- |
| Incoming frame size | 2 KB |
| Movement input rate | 40/s, burst 80 |
| Control messages | 10/s, burst 30 |
| Chat | 3/s, burst 8; 500 characters |
| Outbound queue per client | 128 frames |
| Reconnect grace before removal | 10 s |

Sustained violations disconnect the client. Text is trimmed of control characters on the server.
