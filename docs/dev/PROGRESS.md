# Progress — read this first when resuming

**Current item:** #9 DISC-CHART-01 histogram + brush + series actions (not started)
**Last completed step:** #8 DISC-SIDEBAR-01 in PR 9 (v0.18.0): "Search field names", type filter popover with per-type counts + active-count button, collapsible Selected / Popular / Available groups with count badges, Popular fields from per-viewer usage (`src/state/fieldUsage.ts`), "Add X as column" button names
**Next step:** branch `feat/disc-chart-01`; verify the histogram against DISC-CHART-01 (docs/spec/10-discover.md): brush to zoom, bar click/right-click series actions (filter for/out via registry, view this bucket), interval label, hit count, toggle chart. Build the gaps.
**Open issues:** none. Deferred: field list Empty group (needs a per-field existence query; removed in the perf plan, D13), Meta fields (none in ClickHouse), runtime "Add a field". Grid: Summary column, sample size, Find, Fullscreen, Save table (#16). Popover: date distribution, Examples, Visualize (#15).

## Environment notes
- Local clone: `C:\Users\Ariel\clickhouse-observe-grafana-dev` (fork `ArielShaharabani/clickhouse-observe-grafana`, `upstream` = PoorTuna).
- On Windows, keep `git config core.autocrlf false` + `core.eol lf` in this clone, or `.config/entrypoint.sh` gets CRLF and the Grafana container fails with `exec /entrypoint.sh: no such file or directory`.
- Stack: `docker compose up -d --build grafana clickhouse` (skip `ollama`, `otel-collector`). Grafana at http://localhost:3000 (anonymous admin). After `plugin.json` or provisioning changes: `docker restart poortuna-clickhouse-observe-app`.
- If the ClickHouse volume already existed before `04_spec_fixture.sql` was added, load it once by hand:
  `docker exec -i clickhouse-observe-grafana-dev-clickhouse-1 clickhouse-client --multiquery < scripts/clickhouse-init/04_spec_fixture.sql` (only on an empty `spec_logs`, or rows double).

## Baseline (v0.10.0, 2026-11-17)
typecheck ✅ · lint ✅ (0 errors, 18 warnings) · test:ci ✅ 730 tests · build ✅ · e2e: original `appConfig.spec.ts` was stale scaffolding (replaced).

## Session log
- 2026-11-17 — Forked, baseline recorded, test foundation merged (PR 1). SHARED-STATE done (PR 2). SHARED-AUTOCOMPLETE done (PR 3). DISC-SEARCH-02 done (PR 4). DISC-FILTER-01 done (PR 5). SHARED-ACTION-01 done (PR 6, review fixes included). Context snapshot file `CONTEXT.md` added — refreshed after every feature. DISC-SIDEBAR-02 done (PR 7).
