# Progress — read this first when resuming

**Current item:** #4 DISC-FILTER-01 filter pills (not started)
**Last completed step:** #3 DISC-SEARCH-02 merged (v0.13.0): match highlighting (`src/sql/kql/highlight.ts`), dirty-query Update button
**Next step:** branch `feat/disc-filter-01`; e2e for pill actions (disable re-runs + struck through, exclude flips to NOT, edit, delete, count badge if any), add Pin/Unpin to the pill menu using `pinFilterInStore`/`unpinFilterInStore` (`src/state/sharedSearch.ts`), and unpin on delete of a pinned pill. Integration IT-B.
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
- 2026-11-17 — Forked, baseline recorded, test foundation merged (PR 1). SHARED-STATE done (PR 2). SHARED-AUTOCOMPLETE done (PR 3). DISC-SEARCH-02 done (PR 4).
