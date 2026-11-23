# Progress — read this first when resuming

**Current item:** performance round (2026-11-20). Findings doc: https://claude.ai/artifact/H7KztWygvq7rWW8uS88BYq (10 ranked issues). Perf data: ClickHouse tables `perf_logs_1m/10m/50m` (same schema as spec_logs; regenerate with the INSERT in CONTEXT if lost); data views `perf-1m/10m/50m` added on :3000 via the plugin settings API (not provisioned; lost on Grafana restart). Harness scripts: `C:/Users/Ariel/kibana-compare/perf*.js`.
**Last completed step:** #- R5-PADDING (Padding/spacing polish) in PR 82 (v0.78.1).
**Next step:** wait for the user. Batch 11 (PR 79, v0.70.0–0.72.0) merged: round-3 fixes; statuses in the round-3 doc https://claude.ai/artifact/LgnMPnmbFirkAKqnQjiNpf ("Fix status" table). Open for the user's call: row 15 (saved searches listed among dashboards: tag-based lookup + migration?). Gotchas: delete a worktree's node_modules junction before `git worktree remove` (it empties the main clone's node_modules); never prettier whole files; CRLF files; check gate exit codes.
**Open issues:** none. Kibana comparison stack is STOPPED during the perf round (restart at the end) at :5601 (`C:/Users/Ariel/kibana-compare`; stop it with `docker compose stop` if e2e needs memory). Comparison test objects remain (dashboards "Logs Explorer export" x2 and `cmp-o-*` on :3000, `cmp-k-*` in Kibana; e2e-created `observe-saved-search` dashboards); delete only if the user asks. Remote `autosave/*` branches can be deleted.
**Round 6 (2026-11-23, in progress):** branch `feat/batch-13`, brief `C:/Users/Ariel/co-wt/r6-BRIEF.md`. Merged: view switch fix, r6-ui, r6-sec, r6-tz (day+ buckets stay server-zone), r6-popover, removable Y axis (`r6-remove-y`). Running: agent `feat/r6-panels` (edit any dashboard panel in Visualize; not-lossless saves warn at Save: Save as new panel / Replace anyway). Then: `npm ci` (deps changed), full jest + lint, full e2e, security re-check of panelImport, fold `docs/dev/pending/R6-*`, version + CHANGELOG, PR, merge, rebuild :3000. To check: Discover at max sidebar width on a 1000px window hung an agent's Playwright run.
**Batch status:** none open. Batch 12 (PR 82, round-5 user list, v0.73.0–0.78.1) merged 2026-11-22 after full e2e, security review (clean) and code review (9 findings fixed). Deferred: Configuration nav highlight is Grafana-owned; ClickHouse keeps running abandoned queries (no KILL QUERY); buildFieldTopValuesQuery sample step still uses a `value` alias; typed JSON paths in charts/top values read other-typed values as empty; dynamic JSON paths not in the e2e fixture.

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
