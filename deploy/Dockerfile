# Multi-stage build: web bundle + static Go binary in a distroless image.
# Multi-arch (linux/amd64, linux/arm64): the web bundle and the Go cross-compile run on the build host,
# only the final distroless layer is per-architecture, so no emulation is needed.
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
WORKDIR /w
RUN corepack enable
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS server
ARG TARGETOS=linux
ARG TARGETARCH
WORKDIR /s
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags="-s -w" -o /out/opengather ./cmd/opengather \
 && mkdir /data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /out/opengather /app/opengather
COPY --from=web /w/dist /app/web
COPY --from=server --chown=65532:65532 /data /data
ENV OG_STATIC_DIR=/app/web OG_DB=/data/opengather.db OG_ADDR=:8080
VOLUME /data
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/app/opengather"]
