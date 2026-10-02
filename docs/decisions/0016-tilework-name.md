# 0016: Tilework identity and runtime namespace

Date: 2026-10-02. Status: accepted.

## Context

The project needs its own stable name while remaining describable as an independent open source alternative to Gather. A rename must cover the shipped application, site, source modules, installation commands and operational identifiers.

## Decision

Use **Tilework** as the brand and `tilework` as the repository, Go module, command and Docker service name. Application environment variables use `TILEWORK_`, Prometheus metrics use `tilework_`, the session cookie is `tilework_session`, browser preferences use `tilework.*`, and the test hook is `window.__tilework`. Gather appears only in comparisons and affiliation or asset disclaimers.

Reject non-empty retired `OG_` variables at startup with a migration message. This prevents an old production environment from being mistaken for an unconfigured development environment. Existing databases retain their schema and data; production Compose exposes explicit volume and database overrides to reuse them and Caddy's TLS state. See [Upgrading to Tilework](../../deploy/README.md#upgrading-to-tilework).

Preserve historical benchmark inputs byte-for-byte and read both container naming schemes in the report generator. A rebrand is not a new capacity measurement.

## Impact

Performance: no changes to the tick, networking, rendering or media algorithms; the startup configuration scan runs once. Maintenance: one consistent namespace across code, scripts and documentation. Installation: existing deployments must rename variables, reuse their volumes and database path, update monitoring, and have users rejoin; fresh installations use Tilework defaults.
