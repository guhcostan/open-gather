# 0003 · How media rooms are split

- **Status:** accepted (2026-09-29)

## Context

Putting everyone in the office into one WebRTC room would expose each person to (and bill bandwidth for) dozens of tracks they should not see. A P2P mesh does not scale to groups.

## Decision

There are two kinds of SFU room, both **small and created on demand**:

1. **Meeting room**: one per map area of kind `room`, with an explicit access rule (open, members only, admins only, or a list). Name: `<instance>.o<office>.r.<area>`.
2. **Proximity group**: an ephemeral room of at most 8 people (`TILEWORK_MAX_GROUP`). Name: `<instance>.o<office>.g<id>`. The `<instance>` part is a random id created once per database, so two installations can share one LiveKit server without touching each other's rooms (see [0008](0008-token-lifetime-and-reconciliation.md)).

A person is in at most one group at a time. The world server decides the composition and only then issues an SFU token for that room.

### Formation rules (hysteresis)

| Situation | Rule | Default |
| --- | --- | --- |
| Join | be within 64 px of a member **and** within 80 px of the group centroid, for | 0.5 s |
| Leave | stay beyond 96 px of the nearest member **or** 112 px from the centroid, for | 1.5 s |
| Switching groups | not possible: you must leave first, then join | — |
| Chains of avatars | the centroid distance limit and the size cap stop a line of people from merging the whole office | max 8 |
| Meeting room | enter/leave the area, with a dwell of | 0.4 s / 0.8 s |

Only people who gave consent **and** have the "available" status take part. Becoming busy, away or invisible removes the person from the group immediately.

## Why this avoids a single office-wide room

The SFU room is the boundary of who can hear and see whom. Since each group holds at most 8 people (or the occupancy of one meeting room), the number of tracks a person subscribes to is bounded by group size, not office size.

## Consequences

- Distributing offices across instances and splitting out a media server later is natural: the only contract between the two is "issue a token for room X" and "remove participant from room X".
- Revocation removes the participant from the SFU when they leave the group. Tokens cannot be revoked, so their lifetime was cut to 30 s and a reconciler evicts unauthorised participants, see [0008](0008-token-lifetime-and-reconciliation.md) and [Privacy and security](privacy-and-security.md).
