# 0005 · Token issuing and revocation without the server SDK

- **Status:** accepted (2026-09-29)

## Decision

The Go server issues access tokens (HS256 JWTs in the LiveKit token format) and calls the LiveKit admin API (`RoomService/RemoveParticipant`, HTTP/JSON) with its own small code instead of importing the full server SDK.

## Reason

Keep the binary and dependency tree small and isolate everything that talks to the SFU in the `media` package.

## How this was validated

By **end-to-end test**, not by reading the documentation line by line: LiveKit 1.13.7 accepted the tokens, browsers published and subscribed to real media, and the removal call emptied the room. Re-read the official token and API documentation before upgrading LiveKit.

## Issued tokens

- scoped to **one room** and one identity;
- `canPublish` limited to the microphone, camera and screen-share sources;
- `canPublishData` off;
- valid for 5 minutes (a connection window).

## Accepted risk

If LiveKit changes its token format, the `media` package breaks. The smoke test (`e2e/smoke.mjs`) exercises exactly that path.
