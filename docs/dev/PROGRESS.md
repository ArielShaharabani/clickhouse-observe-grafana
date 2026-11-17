# Progress — read this first when resuming

**Current item:** #12 LENS-TYPE-01 — PR 13 open, review findings NOT yet fixed (branch `feat/lens-type-01`)
**Last completed step:** #12 LENS-TYPE-01 in PR 13 (v0.22.0): `src/lens/ChartTypeSwitcher.tsx` — button "Chart type: X" opens a searchable listbox ("Search visualizations", name + description), current ticked, arrows/Enter/Esc, sub-type radio Stacked/Percentage/Unstacked for bar/area; Metric → Bar adds the time axis back
**Next step:** fix PR 13 /code-review findings, rerun gates, merge, then #13. Findings: (1) bar now re-adds a time axis when empty, so `removeDim` (LensPage ~197, `lostTime` excludes bar) can't remove a bar's only bucket — include bar in lostTime / re-pick via chooseChart; (2) switcher popover clipped inside `.dims` (overflow-y auto) — render in a Portal or position fixed; (3) show the sub-type control for line too; (4) Esc must also stopPropagation; (5) close the popover on focus leaving (Tab); (6) clamp `active` once (empty list → -1); (7) use `useId()` for listbox/option ids; (8) prettier: double blank line in LensPage.tsx, long `filterChartTypes` line. Reviewer also suggested @grafana/ui Select instead of the custom listbox — optional (D17 explains the custom choice).
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
