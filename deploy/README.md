# Self-hosting Tilework (single node)

Two stacks, deliberately different:

| | `docker-compose.local.yml` | `docker-compose.yml` (production) |
|---|---|---|
| `TILEWORK_ENV` | `dev` | `production` (refuses insecure config) |
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
4. Create the first administrator invite: `docker compose -f deploy/docker-compose.yml --env-file deploy/.env run --rm tilework -invite admin` prints `/?invite=…`; open it on your domain. Then invite others from *Settings → Invite people* (admins only).
5. `docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build`.

The stack uses the prebuilt image `ghcr.io/guhcostan/tilework:latest` (linux/amd64 and linux/arm64, published by `.github/workflows/docker.yml`). Drop `--build` to pull it instead of building on the server; set `TILEWORK_IMAGE` in `.env` to pin a version.

### No domain yet?

Any wildcard-IP DNS service works for a first try, for example `APP_DOMAIN=office.203-0-113-7.sslip.io` and `LIVEKIT_DOMAIN=rtc.203-0-113-7.sslip.io` (replace with your public IP, dots as dashes). Caddy gets real certificates for them. Use your own domain for anything that matters: these hostnames depend on a third-party resolver and share Let's Encrypt rate limits with everyone else using them.

## Public demo mode

`DEMO=1` turns a production stack into a public sandbox ([decision 0011](../docs/decisions/0011-public-demo.md)):

- anyone can join **without an invite, always as a member** (never as administrator, even as the first visitor); anonymous sign-ups are limited to about one every 5 s per IP, burst 5;
- every `DEMO_RESET_HOURS` (default 6, on wall-clock boundaries) the office map is restored to the starter office and the office chat and all whiteboards are wiped; members and their sessions are kept;
- the join screen and the top bar tell visitors it is a public demo and when it resets.

Recommended with it: `MAX_PLAYERS=60`, `SESSION_DAYS=1`. The operator still creates an administrator with a CLI invite (step 4 above). Production guard rails stay on (HTTPS, real LiveKit keys, origin list).

## Oracle Cloud "Always Free"

Scripts in [`deploy/oracle/`](oracle/) reproduce the public demo host:

1. `deploy/oracle/provision.sh` (needs the OCI CLI configured) creates a VCN, an internet gateway, a security list that opens exactly 22, 80, 443, 7881/tcp, 7882/udp and 3478/udp, a public subnet and an Ubuntu 24.04 VM, and prints its public IP. Default shape: Ampere A1 (2 OCPU, 12 GB). A1 capacity is often exhausted ("Out of host capacity"); `TILEWORK_OCI_SHAPE=VM.Standard.E2.1.Micro` uses the always-free AMD micro VM (1 GB RAM) instead.
2. `ssh ubuntu@IP "bash -s" < deploy/oracle/bootstrap-host.sh` opens the host firewall (Oracle's Ubuntu image rejects everything but SSH even when the security list allows it), adds 2 GB of swap and installs Docker with Compose.
3. Copy `deploy/` to the VM, write `deploy/.env` and start the stack as above.

Nothing here is billed while you stay inside the Always Free limits. The micro VM's CPU is small: it is fine for a handful of people in calls, not for a large meeting (no capacity was measured on it).

### HTTPS, ICE, STUN/TURN and credentials

- Browsers only allow camera, microphone and screen capture on HTTPS (or localhost), so TLS is not optional. Caddy obtains and renews certificates; ports 80/443 must be reachable for the ACME challenge.
- **ICE/STUN:** LiveKit runs with `use_external_ip: true` and a single UDP port (7882) plus 7881/tcp as a fallback. The server discovers its public address with STUN, so it must be able to reach the internet.
- **TURN:** LiveKit's embedded TURN listens on 3478/udp for clients that cannot use UDP directly. Networks that block all UDP fall back to ICE/TCP on 7881. **TURN over TLS on 443 is not configured** (it needs a certificate mounted into the LiveKit container); strict corporate firewalls may need it.
- **Credentials are short-lived and scoped:** the app server mints a LiveKit join token per conversation (valid 30 seconds plus LiveKit's 60 s clock-skew tolerance, one room, one identity, publish sources limited to microphone/camera/screen share) and removes the participant from the SFU when they leave or lose permission. There are no long-lived shared media credentials in the browser. `LIVEKIT_API_SECRET` never leaves the server.
- **Not verified in this repository:** the TURN relay path and behaviour behind strict NAT/firewalls. Test it (e.g. with a phone on mobile data and UDP blocked) before relying on it.

### Operations

- Health: `/healthz` (liveness), `/readyz` (database reachable), `/metrics` (Prometheus text; **disabled unless `METRICS_TOKEN` is set** in `.env`, at least 16 characters; then scrape `tilework:8080/metrics` from inside the network with `Authorization: Bearer <token>`; also blocked on the public hostname by the Caddyfile). Logs are structured JSON on stdout and contain no chat content and no tokens.
- **Backup** (consistent while running): `docker compose … run --rm tilework -backup /data/backup-$(date +%F).db`, then copy it out of the volume (`docker compose … cp` or a bind mount). Store copies off the host.
- **Restore:** stop the stack, replace `/data/tilework.db` in the volume with the backup (delete any `-wal`/`-shm` files next to it), start the stack. Everyone is signed out of nothing: sessions are in the database.
- **Upgrade:** take a backup, `git pull`, `docker compose … up -d --build`. Schema migrations run automatically at start, inside a transaction, forward-only. To roll back the code, restore the backup taken before the upgrade.
- **Update LiveKit:** the image is pinned to `v1.13.7`. Re-read the release notes and re-run the end-to-end suite (`e2e/`) before bumping.

## Upgrading to Tilework

Tilework is the project's name as of 2026-10-02. Before replacing an existing installation, take an online backup with the currently installed binary and save your Compose configuration. Stop the old stack without `down -v`; never remove its volumes.

- Rename application environment variables from `OG_` to `TILEWORK_`, including `OG_ENV` to `TILEWORK_ENV=production`, and remove the old variables. The new binary refuses non-empty old variables instead of silently using development defaults. LiveKit variables and the database schema are unchanged.
- Use `tilework` for the binary, Compose service and project, and `ghcr.io/guhcostan/tilework` for the image. Update Git remotes to `https://github.com/guhcostan/tilework.git` and bookmarks to `https://guhcostan.github.io/tilework/`.
- Preserve your actual volume names and database path. For the previous default production stack, add these overrides to `deploy/.env` (confirm the names first with `docker volume ls`; installations using a custom project name have different names). These overrides reuse office data and TLS state. Fresh installs use Tilework names throughout.

```env
TILEWORK_DATA_VOLUME=opengather_og-data
TILEWORK_DB=/data/opengather.db
TILEWORK_CADDY_DATA_VOLUME=opengather_caddy-data
TILEWORK_CADDY_CONFIG_VOLUME=opengather_caddy-config
```
- For the previous default local evaluation stack, set `TILEWORK_DATA_VOLUME=opengather-local_og-data` and `TILEWORK_DB=/data/opengather.db` in the shell (or an env file passed with `--env-file`) before starting the new local Compose file. Confirm the volume name first. Otherwise Compose creates an empty office.
- Monitoring now reads `tilework_*` metrics. Session cookies are named `tilework_session`; browser preferences use `tilework.*`. Users need to rejoin with an invite and choose their local preferences again; stored office content remains in the reused database. Media capture still requires explicit consent.

Historical benchmark files under `bench/results/` retain the names captured when they were measured. They are not measurements of the renamed release. The report reader accepts both historical and Tilework container names.
