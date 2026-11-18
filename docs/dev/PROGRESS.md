# Progress — read this first when resuming

**Current item:** batch PR (feat/batch-1: #16d PR 27, #22 PR 26, #25 PR 28, #23 PR 29 — folded 0.32.0–0.35.0, D28–D31); PR 25 (lens-dataview #16b/#16c) being fixed separately.
**Last completed step:** batch-1 folded (#16d DATAVIEW-TIME 0.32.0, #22 DISC-FIELDSTATS-01 0.33.0, #25 SHARED-PERF-01 0.34.0, #23 LENS-DIM-03 0.35.0).
**Next step:** merge the batch PR (squash), close PRs 26/27/28/29 as superseded. PR 25: whichever of 25 / batch merges second renumbers its version and D number after the other (both currently claim 0.32.0 / D28). Then PLAN todos: #26 LENS-CHART-01 next. E2E: `--workers=3`, jest `--maxWorkers 1` (ClickHouse memory-capped); `scripts/dev/e2e-affected.sh` lists the per-branch specs.
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
