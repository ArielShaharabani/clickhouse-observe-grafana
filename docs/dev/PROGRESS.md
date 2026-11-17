# Progress — read this first when resuming

**Current item:** #14 LENS-INTERACT-01 (in progress, branch `feat/lens-interact-01`)
**Last completed step:** #13 LENS-DIM-01/02 in PR 14 (v0.23.0): `src/lens/DimensionEditor.tsx` (Quick function grid, Field combobox of compatible fields, Percentile, Name with auto label, Top values size, Remove/Close), `src/lens/dimensions.ts` helpers, percentile op (`quantile(p/100)`, clamped 1–99), custom `name` on every dimension, "+ Add" slots per group
**Next step:** built: `src/lens/render/XyChart.tsx` (custom-drawn bar/line/area: stacked/percentage/unstacked, clickable marks with aria-labels "x · series: value", time brush, legend toggle + ⋮ Filter for/out), `src/lens/FilterChooser.tsx` (modal "Select filters to apply"), LensPage: editable FilterPills bound to URL `filters`, click → filters via registry. Next: unit tests (stackValues, chooser), e2e `tests/features/lens-interact-01.spec.ts` (single click → pill + 9,264; stacked → chooser; brush; legend filter out; Discover sees the pill), update lens-auto/type e2e that expect data-panel timeseries/barchart (now "xy"), gates, docs, PR.
**Open issues:** none. Deferred Lens items: per-group drag-and-drop (LENS-DIM-01 DnD; workspace drop works), formula (#23), advanced metric options (filter by, time shift), value format/colour/axis side (LENS-STYLE-01), date interval picker, "Other" bucket. Deferred elsewhere: DISC-DOC-02 links (#20); histogram now-line; field list Empty/Meta; grid Summary column etc. (#16); popover Visualize (#15).

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
