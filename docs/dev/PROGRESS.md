# Progress — read this first when resuming

**Current item:** performance round (2026-11-20). Findings doc: https://claude.ai/artifact/H7KztWygvq7rWW8uS88BYq (10 ranked issues). Perf data: ClickHouse tables `perf_logs_1m/10m/50m` (same schema as spec_logs; regenerate with the INSERT in CONTEXT if lost); data views `perf-1m/10m/50m` added on :3000 via the plugin settings API (not provisioned; lost on Grafana restart). Harness scripts: `C:/Users/Ariel/kibana-compare/perf*.js`.
**Last completed step:** PR 58 (perf batch 8) merged as v0.57.0; :3000 rebuilt; ClickHouse recreated (3.5 GiB cap committed); perf data views re-added; perf re-measured and recorded in the perf doc (all fixed except #3 partly, #8 deferred, #10 not ours).
**Next step:** fixing round-2 findings (user approved all on 2026-11-20, perf first; NOT #14 map-key number aggregation, NOT #15 chart types/functions — need a separate decision; #16 Other two-pass stays deferred per D52). Batch branch `feat/batch-9` (worktree co-wt/batch-9): done #1 healthcheck, #2 stale histogram on invalid query, #3 dashboard table 1,000 rows + pagination, #6 tooltip counts, #10 volume panel maxDataPoints 60; merged PR 61 perf-samples (#5). Agents running: perf-urlq (#4, co-wt/perf-urlq), r2-dash-flow (#11 #13 #25), r2-viz-polish (#22 #23 #24), r2-filter-groups (#7). Still to do after perf-urlq merges (Discover files): #8 layout density, #9 saved-search edges, #17 bd notice, #18 TimestampTime ISO/permalink, #19 pager total, #20 'sample' wording, #21 millisecond interval; #12 saved searches in dashboard list (needs design). Then fold pending/*.md, version bump, full e2e on :3021 (co-batch-4 container, point it at batch-9 dist), merge, recreate ClickHouse (healthcheck), update the round-2 doc.
**Open issues:** none. Kibana comparison stack is STOPPED during the perf round (restart at the end) at :5601 (`C:/Users/Ariel/kibana-compare`; stop it with `docker compose stop` if e2e needs memory). Comparison test objects remain (dashboards "Logs Explorer export" x2 and `cmp-o-*` on :3000, `cmp-k-*` in Kibana; e2e-created `observe-saved-search` dashboards); delete only if the user asks. Remote `autosave/*` branches can be deleted.
**Batch status:** none open.

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
