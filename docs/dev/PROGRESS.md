# Progress — read this first when resuming

**Current item:** performance round (2026-11-20). Findings doc: https://claude.ai/artifact/H7KztWygvq7rWW8uS88BYq (10 ranked issues). Perf data: ClickHouse tables `perf_logs_1m/10m/50m` (same schema as spec_logs; regenerate with the INSERT in CONTEXT if lost); data views `perf-1m/10m/50m` added on :3000 via the plugin settings API (not provisioned; lost on Grafana restart). Harness scripts: `C:/Users/Ariel/kibana-compare/perf*.js`.
**Last completed step:** #- R4-VIZ (Visualize round-3 fixes: percentile rank, pie labels, faster open) in PR 79 (v0.72.0).
**Next step:** wait for the user. Batch 11 (PR 79, v0.70.0–0.72.0) merged: round-3 fixes; statuses in the round-3 doc https://claude.ai/artifact/LgnMPnmbFirkAKqnQjiNpf ("Fix status" table). Open for the user's call: row 15 (saved searches listed among dashboards: tag-based lookup + migration?). Gotchas: delete a worktree's node_modules junction before `git worktree remove` (it empties the main clone's node_modules); never prettier whole files; CRLF files; check gate exit codes.
**Open issues:** none. Kibana comparison stack is STOPPED during the perf round (restart at the end) at :5601 (`C:/Users/Ariel/kibana-compare`; stop it with `docker compose stop` if e2e needs memory). Comparison test objects remain (dashboards "Logs Explorer export" x2 and `cmp-o-*` on :3000, `cmp-k-*` in Kibana; e2e-created `observe-saved-search` dashboards); delete only if the user asks. Remote `autosave/*` branches can be deleted.
**Batch status:** round 5 (user list of 15 items, 2026-11-22) in progress. Brief `C:/Users/Ariel/co-wt/r5-BRIEF.md`. Agents (worktrees co-wt/<b>, branches feat/<b>, pending files docs/dev/pending/R5-*.md): r5-viz-layout (#1 resize, #3 table pagination, #14 breadcrumbs; sonnet), r5-viz-state (#2 tab selection, #8/9 empty viz, #6 inspect SQL expanded; sonnet), r5-querybar (#12 shared search bar, #13 label, #5 schema button; sonnet), r5-json (#10 JSON Payload, #7 field type badges; opus), r5-tabs (#4 stuck tab blocks others; opus). After they finish: batch-12 branch, then #11 padding (haiku) on it, one full e2e, merge. #15 (sampling rare values) = question to the user, wait for decision.

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
