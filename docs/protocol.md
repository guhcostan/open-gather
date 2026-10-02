# WebSocket protocol

JSON text frames, short field names (see [decision 0004](0004-json-protocol.md)). The connection is authenticated by the session cookie. The server closes the socket with a code that tells the client what to do ([close codes](#websocket-close-codes)); **1009** means a frame was too large.

Every connection starts with a full `hello`; the same happens on every reconnect, so the client never needs to merge state across connections.

## Client to server

| Message | Fields | Meaning |
| --- | --- | --- |
| `in` | `s` seq, `x`, `y` (-1, 0, 1), `b` run | movement intent; sent on change and every 400 ms while held. `b: true` runs at `cfg.run` times the walking speed |
| `go` | `x`, `y` tile, or `id` of a player | run there along a path the server finds (walls, locked and forbidden rooms respected, portals avoided); any movement key cancels it |
| `st` | `v` | set status: `available`, `busy`, `away`, `invisible` |
| `consent` | `b` | opt in or out of automatic conversations |
| `chat` | `sc` (`o` office, `g` group, `d` direct), `text`, `id` (peer for `d`) | send a message |
| `loc` | `id` | ask where a person is |
| `sync` | none | ask for the current state of everything in view (sent when a hidden tab becomes visible) |
| `tok` | none | request a fresh media token for the current conversation |
| `emo` | `n` 1-8 | show a reaction above your avatar (700 ms server cooldown); 8 is a short dance (key Z) |
| `hand` | `b` | raise or lower your hand (shown in the roster and over the avatar) |
| `note` | `text` | set your status note, one line, at most 60 characters ("" clears it); kept in memory only |
| `wave` | `id` | wave at somebody anywhere in the office (2 s cooldown); busy and away people are not disturbed |
| `use` | `x`, `y` tile | interact with the object at that tile (note, site, image, whiteboard); the server checks distance and area access |
| `fol` | `id` (0 stops) | follow that player; any movement key stops it |
| `lead` | `id` | ask that player to follow you (they decide) |
| `lock` | `b` | lock or unlock the meeting room you are standing in |
| `knock` | `n` area index | knock on a locked room or an assigned private office you stand close to |
| `kans` | `id`, `b` | admit or decline a knock (only from inside the room; in an assigned office only an owner or an admin) |
| `wb` | drawing ops | whiteboard edits: `draw` (batched pen points or one text), `del`, `undo`, `clear` (admin), `close`; all bounded, see decision 0010 |
| `ping` | `c` | round-trip probe |

## Server to client

| Message | Fields | Meaning |
| --- | --- | --- |
| `hello` | `you`, `role`, `status`, `office`, `cfg`, `map`, `roster`, `chat` | initial state; `cfg` has speed, the run multiplier (`run`), tick, media availability, your position and the areas denied to you; `chat` is the persisted office chat |
| `w` | `k` tick, `m` [[id, x, y, d]...], `l` [id...] | **state records** in your area of interest and entities that left it |
| `a` | `s`, `x`, `y` | acknowledgement with the authoritative position at the time of input `s` |
| `p` | `a` people added/updated, `d` ids removed | presence roster changes; a person is `{id, n, av, s, r}` plus `h: 1` (hand raised) and `m` (status note) when set |
| `c` | `sc`, `f` from, `to`, `x` text, `ts` | chat message |
| `conv` | `op` = `join` / `m` / `leave` | conversation lifecycle, including room name and token on `join` |
| `map` | `map`, `deny`, optional `x`/`y` | the office map changed (admin edit); `x`/`y` present if you were moved |
| `loc` | `id`, `ok`, `x`, `y`, `a` | answer to a locate request |
| `e` | `id`, `v` 1-7 | somebody's reaction; rendered above their avatar |
| `obj` | `k` note/embed/image, `l` label, `d` content | object content, only after a nearby authorised `use` (never in the map) |
| `fol` | `id`, `n` | you are now following (or stopped, `id` 0) |
| `wv` | `from`, `n` | somebody waved at you |
| `wvr` | `id`, `st` ok / busy / away / offline | what happened to your wave |
| `ac` | `c` [count per area] | visible people per map area, in map order; sent with `hello` and then at most every 2 s when a count changes |
| `ann` | `n` sender name, `x` text | an administrator's announcement banner (one line, at most 280 characters, never stored) |
| `go` | `ok`, `x`, `y` | a walk-to was accepted (the server now steers you, `self` carries the positions) or refused (`ok: false`: no path, nobody there); its end arrives as `fol` with `id` 0 |
| `self` | `x`, `y`, `dx`, `dy`, `d`, `tp` | your authoritative position while following or walking to a place, once more where a guided walk stops, and after a portal (`tp`) |
| `lreq` | `from`, `n` | somebody asks you to follow them |
| `deny` | `d` denied areas, `lk` locked rooms | your blocked-area list (locks change it for everyone) |
| `knk` | `id`, `n`, `a` | somebody knocks on the room you are in (`done` dismisses) |
| `knr` | `st` wait/ok/no/empty, `a` | the answer to your knock |
| `wb` | `op` state/draw/del/clear/closed | whiteboard state and live strokes; deletes carry owner+id |
| `spot` | `op` on/off | office broadcast: speaker, room and token (subscribe-only unless you are the speaker) |
| `pong` | `c` | reply to `ping` |

### State records (`w`)

A record is **not** a position sample: it is the state to extrapolate from ([decision 0006](0006-state-change-records.md)). `d` packs the facing direction and the movement:

~~~text
d = facing | (dx + 1) << 2 | (dy + 1) << 4 | run << 6     facing: 0 down, 1 left, 2 right, 3 up; dx, dy in -1..1
idle = dx = dy = 0
~~~

Clients keep moving the entity with the same rules as the server (speed from `cfg.speed`, times `cfg.run` when the run bit is set, diagonals scaled by 1/sqrt(2), axis-separated collision against the static walls of the map, 1/60 s sub-steps). The server sends a new record when the direction or the run state changes, when reality diverges from that extrapolation, as a 1 s resync, and when you start seeing the entity. The run bit is only set while moving.

Avatars are `{sk, hs, hc, sh, pa, pt}` small integers; `pt` is the companion pet (0 none, 1-8). The server clamps unknown values to 0 and drops unknown fields.

## HTTP endpoints

| Endpoint | Auth | Purpose |
| --- | --- | --- |
| `GET /healthz`, `GET /readyz` | none | liveness, readiness (database) |
| `GET /metrics` | bearer `TILEWORK_METRICS_TOKEN`; open in dev; **disabled (404) in production without a token** | Prometheus text |
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
| `POST /api/admin/announce` | admin | `{text}` (1-280 characters): banner to everybody online; one per 15 s per admin (burst 2); audited as `announce` without the text |
| `PUT /api/map` | admin | validate, apply and save a new map |
| `GET /api/admin/map` | admin | the saved map including hidden interactive-object content (the world map redacts it; editors must round-trip through this endpoint or they will erase object content) |
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
