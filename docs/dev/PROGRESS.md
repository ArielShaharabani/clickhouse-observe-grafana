# Progress — read this first when resuming

**Current item:** performance round (2026-11-20). Findings doc: https://claude.ai/artifact/H7KztWygvq7rWW8uS88BYq (10 ranked issues). Perf data: ClickHouse tables `perf_logs_1m/10m/50m` (same schema as spec_logs; regenerate with the INSERT in CONTEXT if lost); data views `perf-1m/10m/50m` added on :3000 via the plugin settings API (not provisioned; lost on Grafana restart). Harness scripts: `C:/Users/Ariel/kibana-compare/perf*.js`.
**Last completed step:** #- PERF-SEARCH (Performance: newest-first windowed document search, n-gram text index for wildcards) in PR 58 (v0.57.0).
**Next step:** PR 58 = `feat/batch-8` (co-wt/batch-4; perf-metadata + perf-queries + perf-search, folded 0.55.0-0.57.0, gates green 1,724 jest) full e2e on :3021 with 2 workers — first run lost to a PC restart (2026-11-20); re-running, log `C:/Users/Ariel/co-wt/batch8-e2e.log`. Then: fix failures (Sonnet fix agent), merge PR 58; in the main clone run `git checkout -- scripts/clickhouse-config/low-memory.xml` (local temporary cap edit) before `git pull`; recreate ClickHouse to apply the new compose settings (`docker compose up -d clickhouse`, the volume keeps the data); rebuild + restart :3000; re-add the perf data views (plugin settings API, see CONTEXT) and re-run `node C:/Users/Ariel/kibana-compare/perf.js` + `perfq.js`; record before/after in the perf doc's Fix plan section; restart the Kibana stack. THEN (user request 2026-11-20): comparison round 2 — same RCA scenario as round 1 (engineer finding a root cause, identical steps in Kibana :5601 and Observe :3000); document differences in performance, interaction, bugs, functionality, breadth of options; prioritized, in the Claude doc https://claude.ai/artifact/Y5yzCp7mwEvtJtTWYPput7 (outline created). Also re-verify every item of the round-1 doc (https://claude.ai/artifact/Fttf2EfgSpSPZhwCqNLpvM, 45 items) and the perf doc (10 items) on the merged build → section "Fix verification" of the round-2 doc. Do NOT fix anything from it until the user approves each item.
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
