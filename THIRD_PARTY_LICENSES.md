# Third-party licenses

Open Gather's own code is **AGPL-3.0-only** (see [LICENSE](LICENSE)); using it commercially is allowed under that license, with no additional restrictions. All dependencies below are permissively licensed (MIT, BSD, ISC, Apache-2.0, 0BSD) and are compatible with distributing the combined work under AGPL-3.0.

Generated on 2026-09-29 from `pnpm licenses list --prod` and the Go module cache (`go list -deps` for `cmd/opengather` and `cmd/loadgen`). Re-generate before every release; license texts ship inside each package.

## Web client (production dependencies)

| Package | Version | License |
|---|---|---|
| react, react-dom, scheduler | 19.3.0 / 19.3.0 / 0.28.0 | MIT |
| pixi.js (+ @pixi/colord, earcut, eventemitter3, gifuct-js, ismobilejs, parse-svg-path, tiny-lru, @xmldom/xmldom) | 8.21.0 | MIT / ISC / BSD-3-Clause |
| livekit-client, @livekit/protocol, @livekit/mutex | 2.22.3 / 1.50.4 / 1.1.1 | Apache-2.0 |
| @bufbuild/protobuf | 1.10.1 | Apache-2.0 AND BSD-3-Clause |
| jose, loglevel, sdp, sdp-transform, webrtc-adapter, typed-emitter, events, machina, js-binary-schema-parser | various | MIT / BSD-3-Clause |
| rxjs | 7.8.2 | Apache-2.0 |
| tslib | 2.8.1 | 0BSD |

## Server (Go modules linked into the binary)

| Module | Version | License |
|---|---|---|
| github.com/coder/websocket | v1.8.15 | ISC |
| modernc.org/sqlite (+ libc, mathutil, memory) | v1.60.1 | BSD-3-Clause |
| github.com/dustin/go-humanize | v1.0.1 | MIT |
| github.com/google/uuid | v1.6.0 | BSD-3-Clause |
| github.com/mattn/go-isatty | v0.0.24 | MIT |
| github.com/ncruces/go-strftime | v1.0.0 | MIT |
| github.com/remyoudompheng/bigfft | v0.0.0-2023… | BSD-3-Clause |
| golang.org/x/sys | v0.48.0 | BSD-3-Clause |

## Benchmark tool (bench/mediagen, separate Go module, not part of the server binary)

| Module | License |
|---|---|
| github.com/livekit/server-sdk-go/v2, github.com/livekit/protocol | Apache-2.0 |
| github.com/pion/webrtc, pion/rtp and the other pion modules | MIT |

## Separate processes (not linked)

| Software | License | Note |
|---|---|---|
| LiveKit server 1.13.7 | Apache-2.0 | run as its own container/process (SFU) |
| Caddy 2 | Apache-2.0 | optional TLS reverse proxy in `deploy/docker-compose.yml` |
| Chrome / Puppeteer (tests only) | proprietary browser / Apache-2.0 | used by `e2e/`, not distributed |

## Assets

All visual assets are **original to this project**: avatars, tiles, furniture and the UI skin are drawn by code in `web/src/game/art/` and `web/src/theme-gba.css`, and the office layout is defined in `server/internal/gamemap/default.go`. The style is inspired by 2000s handheld RPGs, but no sprite, map, sound, name or code from Gather, Pokémon (Nintendo / Game Freak) or any other game/product was copied.

| Bundled font | License | Where |
|---|---|---|
| Pixelify Sans 5.3.0 (latin 400 and 700, from the `@fontsource/pixelify-sans` package) | SIL Open Font License 1.1 | `web/src/assets/fonts/` (licence text in `PixelifySans-OFL.txt`) |
