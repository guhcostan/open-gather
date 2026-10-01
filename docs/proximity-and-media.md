# Proximity and media

## Consent first

Nobody's camera or microphone is touched before they opt in. The **Enable audio and video** dialog previews camera and microphone, lets you choose devices (and the audio output where the browser supports it), and explains that media is only sent to people nearby or in the same room, and only while your status is *Available*.

## Who can be in a conversation

A person is eligible only if **all** of these are true:

1. they gave consent;
2. their status is **Available** (busy, away and invisible never join automatically, and leave immediately if already in one);
3. their connection is live.

## How groups form

There are two kinds of group, each mapped to one small SFU room (see [decision 0003](0003-media-rooms.md)):

- **Proximity groups** form between free people outside meeting rooms, up to 8 people.
- **Meeting rooms** correspond to map areas with an explicit access rule: open, members only, admins only, a list, or a private office (open while unassigned; then its owners, admins and visitors an owner lets in).

| Rule | Default |
| --- | --- |
| Join a group: within 64 px of a member and 80 px of the centroid | held for 0.5 s |
| Leave a group: beyond 96 px of the nearest member or 112 px of the centroid | held for 1.5 s |
| Group size limit | 8 |
| Enter/leave a meeting room area | 0.4 s / 0.8 s |

Behaviours these rules produce, all covered by unit tests:

- **No flapping at the edge**: the leave threshold is farther than the join threshold, and both require a dwell time.
- **Standing between two conversations**: you stay in the one you are in; there is no direct hop, you must leave first.
- **Chains of avatars**: a long line of people cannot merge into one call, because of the centroid limit and the size cap.
- **Meeting rooms are isolated from the corridor**: someone standing outside the door is not pulled into the room's call.

## What the browser does

- Connects to the room named by the server with a scoped token.
- Publishes the microphone (and camera if enabled) with simulcast and DTX. Screen sharing is available inside a live conversation.
- **Audio is always subscribed; video is limited** to a configurable number of tiles, ranked so active speakers come first. Audio-only mode never subscribes to camera video.
- On leaving a conversation it disconnects and **stops all capture** (the microphone and camera are released).
- If the SFU connection drops unexpectedly, it asks the world server for a fresh token and rejoins.

## Setting up LiveKit for real use

For production, LiveKit needs:

- **HTTPS/WSS** in front of the signalling port (browsers require a secure context for camera and microphone);
- **ICE**: a UDP port range or a single UDP mux port, plus TCP fallback;
- **STUN/TURN**: TURN (ideally over TLS on 443) for users behind restrictive networks;
- **Credentials**: a non-default API key and a secret of at least 32 characters, shared only between LiveKit and the app server.

A complete, tested production configuration is **not written yet** (see [Status](status.md)). Follow the official LiveKit deployment documentation and re-verify against the version you deploy.
