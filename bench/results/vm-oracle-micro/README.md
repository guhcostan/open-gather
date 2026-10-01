# Raw results: free Oracle micro VM, generator over the internet

Measured 2026-10-01. Tables and reading: [docs/benchmark-results.md](../../../docs/benchmark-results.md#on-a-free-cloud-vm-over-the-internet).

| | |
|---|---|
| Measured host | Oracle Cloud Always Free VM.Standard.E2.1.Micro, sa-saopaulo-1, Ubuntu 24.04; the guest sees 2 vCPUs (burstable shape); 1 GB RAM plus a 2 GB swap file (deploy/oracle/bootstrap-host.sh) |
| Stack | deploy/docker-compose.yml: Caddy 2 (TLS), Open Gather, LiveKit 1.13.7; presence runs add deploy/docker-compose.bench.yml (fresh database per run, no demo limits) |
| Server image | ghcr.io/guhcostan/open-gather:latest, as deployed on the VM: be569e2 for the 50 and 100 bot runs, 97e222d for the 200, 300, 500 bot runs and the media runs. The two commits have identical server code (they differ in the web client and docs). Taken from the deploy log, not recorded by the scripts at the time |
| Generator | one laptop in São Paulo (Apple M1 Pro, macOS), home internet; its CPU and upload were **not** measured |
| Sessions | vm-A-50 and vm-A-100 around 16:04 to 16:07 UTC; vm-A-200/300/500 around 21:14 to 21:23 UTC; vm-M-* around 21:23 to 21:31 UTC. Single runs |

Files: `<label>.json` is the generator's report (server/cmd/loadgen or bench/mediagen), `<label>.vm.jsonl` the VM samples (bench/vm-sample.sh), `<label>.log` / `.gen.log` the generator's stderr.

Known quirks in these files:

- Tick percentiles above the histogram's last finite bucket (50 ms) were written as **0** by the loadgen build used here: p99 of vm-A-200, p95 and p99 of vm-A-300, and p50, p95 and p99 of vm-A-500. The committed loadgen writes -1 for this. Do not read those zeros as measurements; the published tables leave tick percentiles out.
- Docker's per-container CPU (`ctr.*.cpu`) leaves stolen time out of its denominator, so it exceeds 100 % of a vCPU under steal; use it only as a ratio between containers.
- The sampler stamped each line when `docker stats` returned, a second or two after the counters were read; later sampler versions stamp the read time.
