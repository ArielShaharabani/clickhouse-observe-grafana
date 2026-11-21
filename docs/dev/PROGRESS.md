# Progress — read this first when resuming

**Current item:** performance round (2026-11-20). Findings doc: https://claude.ai/artifact/H7KztWygvq7rWW8uS88BYq (10 ranked issues). Perf data: ClickHouse tables `perf_logs_1m/10m/50m` (same schema as spec_logs; regenerate with the INSERT in CONTEXT if lost); data views `perf-1m/10m/50m` added on :3000 via the plugin settings API (not provisioned; lost on Grafana restart). Harness scripts: `C:/Users/Ariel/kibana-compare/perf*.js`.
**Last completed step:** #- R3-CHARTS (Visualize chart types: bar horizontal, donut, heat map, gauge) in PR 70 (v0.68.0).
**Next step:** batch 11 = round-3 fixes the user approved in https://claude.ai/artifact/LgnMPnmbFirkAKqnQjiNpf (Fix: rows 1–10, 12–20, 22–23; Skip: 11, 21; #22 Percentile rank raised to P2). Three agents in worktrees `C:/Users/Ariel/co-wt/r4-discover` (rows 1–4, 9, 10, 12–14; Sonnet), `r4-dash` (5–7, 15–17; Sonnet), `r4-viz` (22, 8, 18–20, 23; Opus); brief `C:/Users/Ariel/co-wt/r4-BRIEF.md`; pending files R4-DISCOVER / R4-DASH / R4-VIZ. Then: merge into `feat/batch-11`, fold pending docs, full e2e in chunks, one PR, update the doc's rows. Gotchas: never prettier whole files; CRLF files (LensPage.tsx); check gate exit codes.
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
