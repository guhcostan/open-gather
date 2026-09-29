#!/usr/bin/env bash
# Generates the encoded test media used by mediagen (needs ffmpeg with libopus and libvpx).
# Synthetic patterns, no third-party media. Length must exceed warm-up + measurement window.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p assets
SECS=${SECS:-240}
ffmpeg -y -loglevel error -f lavfi -i "sine=frequency=300:sample_rate=48000:duration=$SECS" -c:a libopus -b:a 32k -ar 48000 -ac 1 -f ogg assets/audio.ogg
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=640x360:rate=15" -t $SECS -c:v libvpx -b:v 500k -maxrate 600k -bufsize 600k -deadline realtime -cpu-used 8 -g 45 -an -f ivf assets/video.raw.ivf
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=1280x720:rate=5" -t $SECS -c:v libvpx -b:v 1200k -maxrate 1500k -bufsize 1500k -deadline realtime -cpu-used 8 -g 25 -an -f ivf assets/screen.raw.ivf
go run ./cmd/ivffix assets/video.raw.ivf assets/video.ivf
go run ./cmd/ivffix assets/screen.raw.ivf assets/screen.ivf
ls -la assets
