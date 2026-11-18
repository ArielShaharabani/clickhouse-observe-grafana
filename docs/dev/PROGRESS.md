# Progress — read this first when resuming

**Current item:** #16 LENS-SAVE-01 save Lens chart to dashboard (in progress on `feat/lens-save-01`; PR 16 merged)
**Last completed step:** #16 core built on `feat/lens-save-01`: `compileLens(..., "dashboard")` ($__timeInterval buckets), `src/lens/panelExport.ts` (buildLensPanel per chart type, transformations, defaultPanelTitle), `src/lens/SaveLensModal.tsx` (saveLens: library first, then new/existing dashboard), `createLibraryPanel` in `src/data/dashboards.ts`, `src/lens/draft.ts` session draft, Save button on Visualize
**Next step:** PR 17 open. Code-review fixes committed (library rollback, new-dashboard title field, multi-metric category split via partition+join, readable names on time+split, draft scoped to datasource+table and written on every shown chart, dashboard-list load error + retry, library-save toast, shared FORMAT_TABLE, compile header). Rebuild dist, rerun full e2e, merge.
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
