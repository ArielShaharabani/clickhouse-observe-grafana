#!/usr/bin/env bash
# Prints the e2e spec files relevant to the current branch's diff against a base (default origin/master),
# for the per-PR e2e gate. The full suite still runs every few merges (see docs/dev/TESTING.md "E2E tiers").
#
#   GRAFANA_URL=http://localhost:30xx npx playwright test $(bash scripts/dev/e2e-affected.sh) --workers=2
#
# Always included: smoke, integration matrix (tests/integration), app config.
# Plus: spec files changed on the branch, and the spec group of each touched source area.
set -euo pipefail
base="${1:-origin/master}"
changed="$(git diff --name-only "$(git merge-base "$base" HEAD)"...HEAD)"

specs=(tests/features/smoke.spec.ts tests/integration tests/appConfig.spec.ts)
add_glob() { for f in $1; do if [ -e "$f" ]; then specs+=("$f"); fi; done; }

while IFS= read -r f; do
  case "$f" in
    tests/*.spec.ts|tests/*/*.spec.ts) specs+=("$f") ;;
    tests/pages/*|tests/fixtures.ts|tests/fixture.ts|playwright.config.ts|scripts/clickhouse-init/*|provisioning/*|src/plugin.json)
      echo tests; exit 0 ;; # shared test infra / fixture data / plugin wiring: run everything
    src/lens/*) add_glob 'tests/features/lens-*.spec.ts' ;;
    src/sql/*|src/state/*|src/data/*|src/types.ts)
      add_glob 'tests/features/shared-*.spec.ts'; add_glob 'tests/features/sec-*.spec.ts'
      add_glob 'tests/features/disc-filter-*.spec.ts'; add_glob 'tests/features/lens-auto-*.spec.ts' ;;
    src/pages/LogsExplorer.tsx|src/components/*) add_glob 'tests/features/disc-*.spec.ts' ;;
  esac
done <<< "$changed"

printf '%s\n' "${specs[@]}" | sort -u | tr '\n' ' '
echo
