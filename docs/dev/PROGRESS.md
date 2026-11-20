# Progress — read this first when resuming

**Current item:** performance round (2026-11-20). Findings doc: https://claude.ai/artifact/H7KztWygvq7rWW8uS88BYq (10 ranked issues). Perf data: ClickHouse tables `perf_logs_1m/10m/50m` (same schema as spec_logs; regenerate with the INSERT in CONTEXT if lost); data views `perf-1m/10m/50m` added on :3000 via the plugin settings API (not provisioned; lost on Grafana restart). Harness scripts: `C:/Users/Ariel/kibana-compare/perf*.js`.
**Last completed step:** sweep done; 3 Sonnet agents running (autosave 30 s): `feat/perf-metadata` (co-wt/parity-grid: #2 duplicate metadata queries, #3 unbounded map-key/JSON-path samples), `feat/perf-queries` (co-wt/parity-xychart: #1 ClickHouse lockout config, #5 reuse result on chart-type switch, #6 surrounding pruning, #8 single-pass Other, #9 axis "1 Mil"), `feat/perf-search` (co-wt/parity-dashboards: #4 newest-first document search, #7 text skip index).
**Next step:** when all 3 report: batch them on master in co-wt/batch-4 (`feat/batch-8`), fold, gates, full e2e `--workers=2` on :3021 (stop Kibana stack first), fix, merge, rebuild + restart :3000, re-run `node C:/Users/Ariel/kibana-compare/perf.js` and record before/after in the doc. NOTE: the running ClickHouse has a hand-set temporary cap (3.5 GiB server via local edit of scripts/clickhouse-config/low-memory.xml in the main clone, uncommitted; container `docker update --memory 4g`); perf-queries will commit the real fix; revert the local edit when merging.
**Open issues:** none. Kibana comparison stack runs at :5601 (`C:/Users/Ariel/kibana-compare`; stop it with `docker compose stop` if e2e needs memory). Comparison test objects remain (dashboards "Logs Explorer export" x2 and `cmp-o-*` on :3000, `cmp-k-*` in Kibana; e2e-created `observe-saved-search` dashboards); delete only if the user asks. Remote `autosave/*` branches can be deleted.
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
