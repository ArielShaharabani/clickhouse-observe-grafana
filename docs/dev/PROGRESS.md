# Progress — read this first when resuming

**Current item:** #8 DISC-SIDEBAR-01 field list (not started)
**Last completed step:** #7 DISC-TABLE-01/02 in PR 8 (v0.17.0): cell-level keyboard navigation (arrows, Home/End, Ctrl+Home/End, PgUp/PgDn, Enter = Expand, Esc), Expand popover (registry `expand` action; full value, JSON pretty-printed, Filter for/out/Copy), Display options (density, body cell lines, remembered per viewer)
**Next step:** branch `feat/disc-sidebar-01`; verify the field list against DISC-SIDEBAR-01 (docs/spec/10-discover.md): grouping (Selected / Popular / Available / Empty / Meta), type icons + type filter, search, counts, add/remove column buttons, keyboard. Build the gaps.
**Open issues:** none. Deferred grid items (spec DISC-TABLE-01): Summary column with match-first ordering, sample-size control (paging fetches on demand), Find in table, Fullscreen, Save table to dashboard (→ LENS-SAVE-01 #16). Deferred popover items (DISC-SIDEBAR-02): date-field time distribution, text/geo Examples, Visualize (#15).

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
