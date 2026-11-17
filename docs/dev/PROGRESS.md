# Progress — read this first when resuming

**Current item:** #11 LENS-AUTO-01 / LENS-SUGG-01 (in progress, branch `feat/lens-auto-01`)
**Last completed step:** #10 DISC-DOC-01 in PR 11 (v0.20.0): pinned fields (sessionStorage, stick to top across documents), Hide null fields, type filter (reuses `FieldTypeFilter`), first/last navigation, "field present" registry action on each row, 25 rows per page
**Next step:** core done and tested (`src/lens/state.ts`, `suggest.ts`, `compile.ts`; 22 unit tests; compiled SQL verified on ClickHouse against fixture counts). Next: `LensPage.tsx` at route `visualize` (plugin.json include + App route; restart Grafana), reads q/filters/time/view from the URL + Lens state from param `lens`; layout = field list (⊕ "Add X to workspace", Records first) · chart (render via PanelRenderer: timeseries/barchart/stat/table/piechart from `shapeLensRows`) · dimension list; suggestions strip; empty state "Drop some fields here to start". Then e2e + docs + PR.
**Open issues:** none. Deferred: flyout permalink + surrounding docs link (DISC-DOC-02 #20); histogram now-line/partial shading; field list Empty/Meta (D13); grid Summary column, sample size, Find, Fullscreen, Save table (#16); popover date distribution, Examples, Visualize (#15).

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
