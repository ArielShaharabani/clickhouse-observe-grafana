# Progress — read this first when resuming

**Current item:** #5 SHARED-ACTION-01 — PR 6 open on branch `feat/shared-action-01`, NOT merged yet
**Last completed step:** registry built, all gates green (772 unit, 25/25 e2e); /code-review returned 10 findings (below)
**Next step:** fix the PR 6 review findings below on `feat/shared-action-01`, rerun gates, comment on PR 6, squash-merge, then start #6 DISC-SIDEBAR-02 (plan for #6 in PLAN.md row 6 + notes at the end of this file).
**Open issues (PR 6 review, fix all before merge):**
1. Copy uses `navigator.clipboard` only → silent no-op on plain-HTTP Grafana, no "Copied" feedback. Fix: `copyToClipboard` with execCommand('copy') fallback + toast/"Copied" feedback (or Grafana ClipboardButton for the copy action).
2. Histogram popover passes the value as `fieldLabel` → names like "Filter for error: error". Pass the breakdown field label.
3. Drawer uses raw attribute key (`ServiceName`) while grid uses display name (`Service`) → align (use one label source).
4. Histogram builds a pill with field '' and keeps only `op` → change `onBreakdownFilter` to accept a FilterPill / give the histogram the breakdown field sqlExpr+label.
5. aria-label contains the full value → truncate value in names (~60 chars).
6. Drawer offers filter for/out on raw Map/JSON container + empty values; grid suppresses them → move the "filterable value" rule into the registry `isCompatible`.
7. Popover empty top value → name "Filter for X: " and generic tooltip; show "(empty)" in names.
8. IT-A test: NaN if service unexpected; hard-coded 8064 → add per-service totals to `tests/fixture.ts`.
9. Actions rebuilt every render for every row → memoize per field/value.
10. not_exists name "Filter for X does not exist" reads ambiguously → "Filter to rows where X is missing" (match tooltip).

## Notes for #6 DISC-SIDEBAR-02 (next feature)
Popover gaps vs spec: numeric stats (min/max/median, 10-bucket distribution toggle), sample size 5,000 (today `sampleSize: 500` in `src/sql/kql/_values.ts:104`) with "Calculated from N sample records", add-as-breakdown icon, "No field data" state, Visualize button (stub until #15). New registry actions `visualize` and `breakdown` go in `src/actions/registry.ts`.

**Open issues:** none

## Environment notes
- Local clone: `C:\Users\Ariel\clickhouse-observe-grafana-dev` (fork `ArielShaharabani/clickhouse-observe-grafana`, `upstream` = PoorTuna).
- On Windows, keep `git config core.autocrlf false` + `core.eol lf` in this clone, or `.config/entrypoint.sh` gets CRLF and the Grafana container fails with `exec /entrypoint.sh: no such file or directory`.
- Stack: `docker compose up -d --build grafana clickhouse` (skip `ollama`, `otel-collector`). Grafana at http://localhost:3000 (anonymous admin). After `plugin.json` or provisioning changes: `docker restart poortuna-clickhouse-observe-app`.
- If the ClickHouse volume already existed before `04_spec_fixture.sql` was added, load it once by hand:
  `docker exec -i clickhouse-observe-grafana-dev-clickhouse-1 clickhouse-client --multiquery < scripts/clickhouse-init/04_spec_fixture.sql` (only on an empty `spec_logs`, or rows double).

## Baseline (v0.10.0, 2026-11-17)
typecheck ✅ · lint ✅ (0 errors, 18 warnings) · test:ci ✅ 730 tests · build ✅ · e2e: original `appConfig.spec.ts` was stale scaffolding (replaced).

## Session log
- 2026-11-17 — Forked, baseline recorded, test foundation merged (PR 1). SHARED-STATE done (PR 2). SHARED-AUTOCOMPLETE done (PR 3). DISC-SEARCH-02 done (PR 4). DISC-FILTER-01 done (PR 5). SHARED-ACTION-01 done (PR 6).
