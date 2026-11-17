# Progress — read this first when resuming

**Current item:** #12 LENS-TYPE-01 one-menu chart switching (in progress, branch `feat/lens-type-01`)
**Last completed step:** #11 LENS-AUTO-01 / LENS-SUGG-01 in PR 12 (v0.21.0): Visualize page (`src/lens/LensPage.tsx`, route `visualize`, nav include, lazy chunk), LensState/suggest/compile (`src/lens/`), PanelRenderer adapter (`src/lens/render/LensChart.tsx`: timeseries/barchart/stat/table/piechart), suggestions strip, dimension groups with remove, Lens state in URL param `lens`
**Next step:** `src/lens/ChartTypeSwitcher.tsx` built and wired into the dimension panel (searchable listbox, keyboard, sub-type radio); 5 component tests pass. Next: e2e `tests/features/lens-type-01.spec.ts` (Metric → Bar → Line, one open + one selection each; q/filters/from/to unchanged), gates, docs, PR.
**Open issues:** none. Lens limits for later features: no "Other" bucket for top values; no per-dimension editor (#13); query/filters edited in Discover (Lens shows them read-only with "Edit query in Discover"; #15 adds the shared bar); charts are PanelRenderer-only (custom-drawn click-to-filter is #14); heat map/treemap/waffle/mosaic/tag cloud not offered (no core Grafana panel). Deferred elsewhere: DISC-DOC-02 links (#20); histogram now-line; field list Empty/Meta; grid Summary column etc. (#16); popover Visualize (#15).

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
