# WebSocket protocol

JSON text frames, short field names (see [decision 0004](0004-json-protocol.md)). The connection is authenticated by the session cookie. The server closes the socket with a code that tells the client what to do ([close codes](#websocket-close-codes)); **1009** means a frame was too large.

Every connection starts with a full `hello`; the same happens on every reconnect, so the client never needs to merge state across connections.

## Client to server

| Message | Fields | Meaning |
| --- | --- | --- |
| `in` | `s` seq, `x`, `y` (-1, 0, 1) | movement intent; sent on change and every 400 ms while held |
| `st` | `v` | set status: `available`, `busy`, `away`, `invisible` |
| `consent` | `b` | opt in or out of automatic conversations |
| `chat` | `sc` (`o` office, `g` group, `d` direct), `text`, `id` (peer for `d`) | send a message |
| `loc` | `id` | ask where a person is |
| `sync` | none | ask for the current state of everything in view (sent when a hidden tab becomes visible) |
| `tok` | none | request a fresh media token for the current conversation |
| `ping` | `c` | round-trip probe |

## Server to client

| Message | Fields | Meaning |
| --- | --- | --- |
| `hello` | `you`, `role`, `status`, `office`, `cfg`, `map`, `roster`, `chat` | initial state; `cfg` has speed, tick, media availability, your position and the areas denied to you; `chat` is the persisted office chat |
| `w` | `k` tick, `m` [[id, x, y, d]...], `l` [id...] | **state records** in your area of interest and entities that left it |
| `a` | `s`, `x`, `y` | acknowledgement with the authoritative position at the time of input `s` |
| `p` | `a` people added/updated, `d` ids removed | presence roster changes |
| `c` | `sc`, `f` from, `to`, `x` text, `ts` | chat message |
| `conv` | `op` = `join` / `m` / `leave` | conversation lifecycle, including room name and token on `join` |
| `map` | `map`, `deny`, optional `x`/`y` | the office map changed (admin edit); `x`/`y` present if you were moved |
| `loc` | `id`, `ok`, `x`, `y`, `a` | answer to a locate request |
| `pong` | `c` | reply to `ping` |

### State records (`w`)

A record is **not** a position sample: it is the state to extrapolate from ([decision 0006](0006-state-change-records.md)). `d` packs the facing direction and the movement:

~~~text
d = facing | (dx + 1) << 2 | (dy + 1) << 4     facing: 0 down, 1 left, 2 right, 3 up; dx, dy in -1..1
idle = dx = dy = 0
~~~

Clients keep moving the entity with the same rules as the server (speed from `cfg.speed`, diagonals scaled by 1/sqrt(2), axis-separated collision against the static walls of the map, 1/60 s sub-steps). The server sends a new record when the direction changes, when reality diverges from that extrapolation, as a 1 s resync, and when you start seeing the entity.

## HTTP endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz`, `GET /readyz` | none | liveness, readiness (database) |
| `GET /metrics` | bearer `OG_METRICS_TOKEN`; open in dev; **disabled (404) in production without a token** | Prometheus text |
| `POST /api/join` | invite (production) | create a member; `{name, avatar, invite}`; sets the session cookie |
| `GET /api/me` | cookie | current session or `{"authenticated": false}` |
| `PUT /api/profile` | cookie | change your name and avatar |
| `POST /api/invites` | admin | mint an invite `{role, maxUses, hours}`; the secret is returned once |
| `GET /api/admin/invites` | admin | list invites (id, role, uses, expiry, creator, status); never the secret |
| `DELETE /api/admin/invites/{id}` | admin | revoke an invite |
| `GET /api/admin/members` | admin | list members `{members: [{id, name, role, joinedAt}], you}` |
| `PATCH /api/admin/members/{id}` | admin | change a role `{role: "admin"|"member"}`; the member is disconnected and reconnects with the new role. The last admin cannot be demoted (409) |
| `DELETE /api/admin/members/{id}` | admin | remove a member: sessions deleted, socket closed, call ended. Not yourself, not the last admin (409) |
| `GET /api/admin/audit` | admin | the latest 100 admin actions, newest first |
| `PUT /api/map` | admin | validate, apply and save a new map |
| `GET /ws` | cookie | the world WebSocket |

## WebSocket close codes

| Code | Meaning | Client behaviour |
| --- | --- | --- |
| 4001 | replaced by a newer connection of the same user (another tab) | stop, show "session opened in another tab" |
| 4002 | the client could not keep up (reliable queue overflow) | reconnect with backoff |
| 4003 | an admin removed the member or changed their role | ask `/api/me`: still a member -> reconnect at once; otherwise go to the join screen with a notice |
| 1013 | server closing the connection for another reason | reconnect with backoff |

The reason is recorded on the world goroutine right before the outbound channel closes, so the writer always sends the right code.

## Limits

| Limit | Value |
| --- | --- |
| Incoming frame size | 2 KB |
| Movement input rate | 40/s, burst 80 |
| Control messages | 10/s, burst 30 |
| Chat | 3/s, burst 8; 500 characters |
| Outbound queue per client | 128 frames |
| Reconnect grace before removal | 10 s |
| Join / map / profile requests | rate limited per IP or user; bodies capped (4 KB, 512 KB, 4 KB) |
| Admin API | 5 requests/s per admin, burst 20; bodies capped at 256 B (role change) |

Sustained violations disconnect the client. Text is trimmed of control characters on the server.
