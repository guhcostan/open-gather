# 0015 · Private offices

- **Status:** accepted (2026-10-01)

## Context

People expect a place of their own in a virtual office: a small room with a door, where a call stays private and visitors knock. The starter map had open desks and shared meeting rooms only.

## Decision

- **An office is a room with access mode `office`.** `access.users` lists its owners (at most 4, validated with the map). While the list is empty the office behaves like an open meeting room, including the lock button. Once assigned, the world lets in owners and admins; everybody else needs an owner's yes. No new message types: `knock`, `kans` and `deny` carry it, and an assigned office is always announced in the `lk` (closed) list so clients show the Knock button.
- **Admissions reuse the lock state.** The first visitor an owner admits creates the office's in-memory lock state; like a locked room, it is forgotten when the office is empty. Owners never need admission, the lock control does nothing in an assigned office, and only an owner or an admin is asked and may answer. Pending knocks on assigned offices survive housekeeping (it dropped knocks on rooms without a lock record, which made answers intermittently ignored).
- **Assignment is a map edit.** The editor's assign tool works on desks and offices; it writes `access.users` and names the office "Office N · Name", through the existing admin-only `PUT /api/map`, validation and audit.
- **Starter map.** The default map grows from 60x36 to 60x46 tiles: a hall under the social area (door at x 20-21) and six free offices of 9x6 tiles (the last 8x6). Saved maps are not changed. The doormat decoration now requires a real door frame, so a two-tile corridor is not drawn as one long doormat.

## Consequences

- Performance: no new messages or per-tick work beyond checking each pending knock's area during housekeeping (bounded by players and 64 areas). The map is 28 % larger; interest areas and tick cost do not depend on map size. No new measurement was made.
- Maintenance: Go tests cover free, assigned, a delayed knock answer, guest restrictions, owner re-entry and validation; the `offices` browser scenario uses the editor, the Knock and Let in buttons and the shared call.
- Install: none. Members cannot claim offices themselves; an administrator assigns them.
