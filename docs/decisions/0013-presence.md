# 0013 · Presence: waves, raised hands, status notes, minimap and touch controls

- **Status:** accepted (2026-09-30)

## Context

In a busy office you need to reach somebody who is not next to you without opening a chat, see at a glance where people gather, signal that you want to speak, and say what you are doing. People on phones and tablets had no way to move.

## Decision

- **Wave** (`wave` -> `wv` / `wvr`): a ping to anyone online, anywhere. The receiver gets a card with "Walk to them" (a server-routed run, see decision 0012) and "Wave back". Busy (do not disturb) and away people are not disturbed and the sender is told why; invisible players can neither wave nor be waved at (it would reveal them). 2 s cooldown per sender.
- **Raised hand** and **status note** are roster fields (`h`, `m`), so they reuse the existing roster delta: no new broadcast path. The note is one line of at most 60 characters, cleaned on the server, kept in memory only (the client re-sends its own note after reconnecting) and never logged.
- **Dance** is emote 8: the same rate-limited, area-of-interest fan-out as the other reactions, animated on each client.
- **Minimap**: the client redraws a thumbnail of the already baked map four times a second (not per frame, not through React state) with the people it already knows about (its area of interest) and **per-area head counts** from the server (`ac`). Counts are computed every 2 s and sent only when they change, so the minimap shows busy places across the office without an office-wide position feed. Clicking it runs there.
- **Cues**: synthesised chimes for waves, knocks and direct messages (no audio assets), and opt-in desktop notifications that only fire while the tab is hidden and never include message text.
- **Touch pad**: an on-screen direction pad and run toggle shown on coarse-pointer devices.

## Consequences

- Performance: head counts cost one pass over the players every 2 s and one short message per player per change; waves, hands and notes are rare control messages. The minimap reuses the baked map canvas.
- Privacy: notes are presence, like names, and visible to the office; no message text leaves the page in notifications.
- Maintenance: world tests cover waves (delivery, cooldown, busy, invisible), roster fields, note cleaning, head-count publication and the dance emote; the `presence` browser scenario covers every UI path including the touch pad on an emulated phone.

