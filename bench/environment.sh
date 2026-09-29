#!/usr/bin/env bash
# Records the machine a benchmark ran on. Paste the output next to the results.
echo "date:      $(date -u +%FT%TZ)"
echo "os:        $(uname -srm)"
if [ "$(uname)" = Darwin ]; then
  echo "cpu:       $(sysctl -n machdep.cpu.brand_string) ($(sysctl -n hw.ncpu) logical cores)"
  echo "ram:       $(( $(sysctl -n hw.memsize) / 1073741824 )) GB"
else
  echo "cpu:       $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2 | xargs) ($(nproc) vCPU)"
  echo "ram:       $(free -g | awk '/Mem:/{print $2}') GB"
fi
echo "go:        $(go version)"
echo "ulimit -n: $(ulimit -n)"
echo "git:       $(git rev-parse --short HEAD 2>/dev/null || echo 'no commit')"
