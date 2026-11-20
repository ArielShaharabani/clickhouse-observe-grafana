# Progress — read this first when resuming

**Current item:** none in flight. The Kibana-parity round is DONE (all 45 comparison items, doc https://claude.ai/artifact/Fttf2EfgSpSPZhwCqNLpvM has a status note).
**Last completed step:** PR 49 (batch 6, 0.48.0-0.51.0) and PR 51 (batch 7, 0.52.0-0.54.0) merged; :3000 runs v0.54.0; the Kibana comparison stack (:5601) is running again.
**Next step:** wait for the user (re-compare with Kibana). Deferred follow-ups: pie percent decimals (Grafana pie has no decimals option), migrate browser-only saved searches to shared, edit/rename shared searches, pie per-slice colours in dashboard export, Kibana "now" line on the histogram, Save and return without dialog.
**Open issues:** the Kibana comparison stack (`C:/Users/Ariel/kibana-compare`, `docker compose up -d`) is stopped to free memory during the round; restart it at the end. Comparison test dashboards remain on :3000 ("Logs Explorer export" x2, `cmp-o-*`) and in Kibana (`cmp-k-*`); delete only if the user asks.
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
