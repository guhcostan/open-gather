#!/usr/bin/env bash
# The gauntlet's automatic gates. Usage:
#   scripts/gauntlet.sh                 # static gates + the whole browser suite (CI viewport)
#   scripts/gauntlet.sh social movement # static gates + only these scenarios
#   GAUNTLET_SKIP_E2E=1 scripts/gauntlet.sh
# Prints one PASS/FAIL line per gate and exits non-zero if any gate failed.
# The same lines go to .gauntlet/last-gates.log with the commit, a hash of the working tree and the
# time, so critics can tell whether the gates ran on the code they review.
set -u
cd "$(dirname "$0")/.."
root=$PWD
fails=0
log_dir=$(mktemp -d "${TMPDIR:-/tmp}/og-gauntlet.XXXXXX")
mkdir -p .gauntlet
record=.gauntlet/last-gates.log
fingerprint() {
  (git rev-parse HEAD; git diff HEAD; git ls-files --others --exclude-standard -z |
    while IFS= read -r -d '' file; do
      printf '%s\0' "$file"
      if [ -f "$file" ]; then shasum <"$file"; fi
    done) | shasum | cut -c1-12
}
tree=$(fingerprint)
{ echo "gates for: commit $(git rev-parse --short HEAD), tree $tree, started $(date -u +%FT%TZ), scenarios: ${*:-all}"; } >"$record"

gate() {
  local name=$1; shift
  if (cd "$root" && "$@") >"$log_dir/$name.log" 2>&1; then
    echo "PASS $name" | tee -a "$record"
  else
    echo "FAIL $name (log: $log_dir/$name.log)" | tee -a "$record"
    tail -n 15 "$log_dir/$name.log" | sed 's/^/     /'
    fails=$((fails + 1))
  fi
}

gate gofmt bash -c 'test -z "$(cd server && gofmt -l .)"'
gate go-vet bash -c 'cd server && go vet ./...'
gate go-test-race bash -c 'cd server && go test -race -count=1 ./...'
gate tsc bash -c 'cd web && pnpm exec tsc --noEmit'
gate tsc-tests bash -c 'cd web && pnpm exec tsc -p tsconfig.test.json --noEmit'
gate vite-build bash -c 'cd web && pnpm exec vite build'
gate web-lint node scripts/lint-web.mjs
gate web-unit bash -c "node --test 'web/test/*.test.ts'"
gate site-build bash -c 'cd site && node build.mjs'
if [ -z "${GAUNTLET_SKIP_E2E:-}" ]; then
  gate e2e bash -c 'cd e2e && CI=1 node run.mjs "$@"' _ "$@"
else
  echo 'SKIPPED e2e' | tee -a "$record"
fi

if [ "$tree" != "$(fingerprint)" ]; then
  echo 'FAIL working tree changed during gates; rerun on the final tree' | tee -a "$record"
  fails=$((fails + 1))
fi

echo
if [ "$fails" -gt 0 ]; then
  echo "GATES RED: $fails failed" | tee -a "$record"
elif [ -n "${GAUNTLET_SKIP_E2E:-}" ]; then
  echo 'STATIC GATES GREEN; browser verification SKIPPED' | tee -a "$record"
else
  echo 'GATES GREEN' | tee -a "$record"
fi
echo "finished $(date -u +%FT%TZ)" >>"$record"
exit "$fails"
