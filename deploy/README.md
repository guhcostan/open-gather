# Deploying Open Gather (single node)

Two stacks, deliberately different:

| | `docker-compose.local.yml` | `docker-compose.yml` (production) |
|---|---|---|
| `OG_ENV` | `dev` | `production` (refuses insecure config) |
| LiveKit keys | public dev pair (`devkey`/`secret`) | yours, from `.env`; the server aborts on the dev key or a secret shorter than 32 chars |
| TLS | none (`http://localhost` is a secure context) | Caddy, automatic certificates |
| Joining | anyone reaching the port | invite links only |
| Exposed | 127.0.0.1 only | 80/443, 7881/tcp, 7882/udp, 3478/udp |

## Local evaluation

```sh
docker compose -f deploy/docker-compose.local.yml up --build
# open http://localhost:8080 — the first person to join becomes the administrator
```

## Production

1. Two DNS names pointing to the server: one for the app (`APP_DOMAIN`) and one for LiveKit (`LIVEKIT_DOMAIN`).
2. `cp deploy/.env.example deploy/.env` and fill it in (keys: `openssl rand -hex 8` / `openssl rand -hex 32`).
3. Open the firewall: **80/tcp, 443/tcp, 7881/tcp, 7882/udp, 3478/udp**.
4. Create the first administrator invite: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm opengather -invite admin` prints `/?invite=…`; open it on your domain. Then invite others from *Settings → Invite people* (admins only).
5. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`.

### HTTPS, ICE, STUN/TURN and credentials

- Browsers only allow camera, microphone and screen capture on HTTPS (or localhost), so TLS is not optional. Caddy obtains and renews certificates; ports 80/443 must be reachable for the ACME challenge.
- **ICE/STUN:** LiveKit runs with `use_external_ip: true` and a single UDP port (7882) plus 7881/tcp as a fallback. The server discovers its public address with STUN, so it must be able to reach the internet.
- **TURN:** LiveKit's embedded TURN listens on 3478/udp for clients that cannot use UDP directly. Networks that block all UDP fall back to ICE/TCP on 7881. **TURN over TLS on 443 is not configured** (it needs a certificate mounted into the LiveKit container); strict corporate firewalls may need it.
- **Credentials are short-lived and scoped:** the app server mints a LiveKit join token per conversation (valid 5 minutes, one room, one identity, publish sources limited to microphone/camera/screen share) and removes the participant from the SFU when they leave or lose permission. There are no long-lived shared media credentials in the browser. `LIVEKIT_API_SECRET` never leaves the server.
- **Not verified in this repository:** the TURN relay path and behaviour behind strict NAT/firewalls. Test it (e.g. with a phone on mobile data and UDP blocked) before relying on it.

### Operations

- Health: `/healthz` (liveness), `/readyz` (database reachable), `/metrics` (Prometheus text; blocked on the public hostname by the Caddyfile, scrape `opengather:8080/metrics` from inside the network). Logs are structured JSON on stdout and contain no chat content and no tokens.
- **Backup** (consistent while running): `docker compose … run --rm opengather -backup /data/backup-$(date +%F).db`, then copy it out of the volume (`docker compose … cp` or a bind mount). Store copies off the host.
- **Restore:** stop the stack, replace `/data/opengather.db` in the volume with the backup (delete any `-wal`/`-shm` files next to it), start the stack. Everyone is signed out of nothing: sessions are in the database.
- **Upgrade:** take a backup, `git pull`, `docker compose … up -d --build`. Schema migrations run automatically at start, inside a transaction, forward-only. To roll back the code, restore the backup taken before the upgrade.
- **Update LiveKit:** the image is pinned to `v1.13.7`. Re-read the release notes and re-run the end-to-end suite (`e2e/`) before bumping.
