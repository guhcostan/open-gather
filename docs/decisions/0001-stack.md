# 0001 · Initial stack

- **Status:** accepted (2026-09-29)
- **Context:** the product must be cheap to host, with low CPU, RAM, GPU and bandwidth use, and installable on a single node.

## Decision

| Layer | Choice | Verified version |
| --- | --- | --- |
| UI | TypeScript, React, Vite | React 19.3.0 · Vite 8.3.1 · TypeScript 7.0.2 |
| 2D world | PixiJS (WebGL), kept outside the React render cycle | 8.21.0 |
| API and world | Go, WebSocket (`coder/websocket`) | Go 1.26.5 · websocket 1.8.15 |
| Data | SQLite in WAL mode through `modernc.org/sqlite` (pure Go, no CGO) | 1.60.1 |
| Media | Self-hosted LiveKit as the SFU | server 1.13.7 · `livekit-client` 2.22.3 |
| Runtime | Docker Compose (single node) | — |

Versions were looked up in the official registries (Go module proxy, npm and LiveKit releases) on 2026-09-29.

## Why the pure-Go SQLite driver

It builds without CGO, which keeps static binaries and cross-compilation for the Docker image simple. The expected cost is performance below C SQLite. Because the database only holds durable data (never movement), the gap should stay off the hot path, but this has **not been measured yet**.

## Consequences

- One Go binary serves the API, the WebSocket and the static files.
- Scaling horizontally means splitting offices across instances (see [0003](0003-media-rooms.md)).
- Swapping the SQLite driver later is a change local to the `store` package.
