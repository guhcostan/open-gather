#!/usr/bin/env bash
# Scenario A (presence, no media) + E (mass reconnect) + grouping-cost variant.
# Results land in bench/results/*.json. Run the generator on another machine for a valid capacity claim.
set -u
cd "$(dirname "$0")/.."
DUR=${DUR:-45s}; WARM=${WARM:-8s}
for n in ${SIZES:-100 300 500 1000}; do
  for reg in distributed concentrated; do
    scripts/bench.sh A-$n-$reg $n -region $reg -duration $DUR -warmup $WARM -probes 6 > /tmp/bench-A-$n-$reg.out 2>&1
  done
done
scripts/bench.sh E-storm-500 500 -region distributed -duration 20s -warmup 5s -storm > /tmp/bench-E.out 2>&1
scripts/bench.sh A2-300-concentrated-grouping 300 -region concentrated -consent -duration $DUR -warmup $WARM > /tmp/bench-A2.out 2>&1
echo DONE > /tmp/bench-done
