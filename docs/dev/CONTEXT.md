# Context snapshot — read this to restart

Saved after every feature (and every review-fix round). A new session can resume from this file plus `PROGRESS.md` alone.
Last saved: 2026-11-17, after #8 DISC-SIDEBAR-01 (PR 9).

## Goal
Bring Kibana Discover + Lens style exploration to Grafana on ClickHouse by extending the **ClickHouse Observe** app plugin.
- Spec (source of truth): `docs/spec/` (split from the shared doc https://claude.ai/artifact/7qsfKJMZFjx5RpYK5iF67B). Feature IDs like `DISC-SIDEBAR-02`.
- Order: the spec's Development priority table (importance 5 → 1), tracked in `docs/dev/PLAN.md`. ES|QL out of scope (KQL/Lucene-style only).
- Every feature: tests for its acceptance criteria + integration tests with already-built features (`docs/dev/TESTING.md` matrix).
- Hebrew executive summary (separate, for stakeholders): https://claude.ai/artifact/PaGmHQ6nmh3ccLfmWYFbL9

## Working agreements (from the user)
- Fork `ArielShaharabani/clickhouse-observe-grafana` (upstream PoorTuna is read-only). One branch + PR per feature; merge (squash) once gates pass and `/code-review` findings are fixed.
- Checkpoint (PROGRESS + push) at every step; save this CONTEXT file after every feature. The user watches `/usage` and says "stop" near 80% → commit `wip:`, push, end.
- Models: Opus for foundations/compilers/reviews, Sonnet for well-specified UI, Haiku for log digestion, Fable only if Patterns quality is poor.

## Built so far
| # | Feature | PR | Key files |
| --- | --- | --- | --- |
| 0 | Test foundation: deterministic fixture `default.spec_logs`, provisioned datasource + data views, e2e harness, routing | 1 | `scripts/clickhouse-init/04_spec_fixture.sql`, `provisioning/`, `tests/fixture.ts`, `tests/pages/LogsPage.ts`, `src/components/App/App.tsx` |
| 1 | SHARED-STATE: interval/breakdown in URL, pinned filters, cross-page links | 2 | `src/state/sharedSearch.ts`, `src/data/urlState.ts` |
| 2 | SHARED-AUTOCOMPLETE: scoped value/key lookups, shared field ranker | 3 | `src/autocomplete/service.ts`, `src/autocomplete/rankFields.ts` |
| 3 | DISC-SEARCH-02: matched-term highlighting, "Update" cue | 4 | `src/sql/kql/highlight.ts`, `src/components/SearchBar.tsx`, `LogsTable.tsx` |
| 4 | DISC-FILTER-01: pin across pages (explicit pin transitions, per-table pins) | 5 | `src/components/FilterPills.tsx`, `src/state/sharedSearch.ts` |
| 5 | SHARED-ACTION-01: action registry (filter for/out, copy w/ HTTP fallback, exists/missing; shared field labels) | 6 | `src/actions/registry.ts`, `src/actions/ActionIconButton.tsx` |
| 6 | DISC-SIDEBAR-02: field stats popover — 5,000-row sample, numeric distribution, breakdown action, empty state | 7 | `src/components/FieldSidebar/FieldStatsPopover.tsx`, `buildNumericStatsQuery` (`src/sql/queryBuilder.ts`), `fetchNumericStats` (`src/sql/kql/_values.ts`) |
| 7 | DISC-TABLE-01/02: cell keyboard navigation, Expand popover, display options (density, body lines) | 8 | `src/components/LogsTable.tsx`, `src/components/CellExpandPopover.tsx`, `src/components/GridDisplayOptions.tsx` |
| 8 | DISC-SIDEBAR-01: field search, type filter with counts, Selected / Popular / Available groups | 9 | `src/components/FieldSidebar/FieldSidebar.tsx`, `FieldTypeFilter.tsx`, `src/state/fieldUsage.ts` |

## Key decisions (details in DECISIONS.md)
- Frontend-only; queries via grafana-clickhouse-datasource (`src/data/runQuery.ts`). Plain React + @grafana/ui, no Scenes.
- URL is the shared search context across pages; pinned filters also in per-tab sessionStorage, changed only by explicit pin transitions, tagged with their table.
- One autocomplete service and one action registry for every surface; field names in actions derived from the SQL expression (`fieldLabelFor`).
- Numeric stats: one-pass sample query (D11); `isBreakdownField` is the single breakdown rule; `chooseBreakdown` in LogsExplorer is the single breakdown setter.
- Field list groups are ARIA regions ("Selected fields", "Popular fields", "Available fields"); row actions appear on hover (hover before clicking in e2e).
- Lens (upcoming): bar/line/area custom-drawn (one-click filter + chooser), table/stat/pie/heatmap via `PanelRenderer` in `src/lens/render/`.

## Environment / gotchas
- Clone: `C:\Users\Ariel\clickhouse-observe-grafana-dev`; git identity set locally; `core.autocrlf false` + `core.eol lf` required (else Grafana container fails on CRLF `entrypoint.sh`).
- Stack: `docker compose up -d --build grafana clickhouse`; Grafana http://localhost:3000. Restart Grafana after `plugin.json`/provisioning changes.
- Docker VM has ~7.5 GB and the user also runs `tagdemo-es`, `tagdemo-kb`, `demo-metabase`; e2e runs on 1 worker, no retries, 15 s expect timeout. Occasional load timeouts → rerun the failed test before assuming a bug.
- Grafana `IconButton` uses `tooltip` as its accessible name → use `ActionIconButton` for specific names. Grid cells have role `cell` and `data-cell="row:col"` (data columns only; the checkbox/expand cells come first); keyboard-focused cell has `aria-selected`. Grafana `Toggletip` hides the rest of the page from the a11y tree while open — close it (Escape) before locating the grid in e2e; open-detail button is named "Open detail". KQL wildcard `*` is a private-use sentinel (`WILDCARD_STAR`) in parsed values.
- Gates: `npm run typecheck && npm run lint && npm run test:ci && npm run build && npx playwright test`; then `/code-review medium master...<branch>`.

## Fixture facts (`tests/fixture.ts`)
41,520 rows, 2026-01-01..08 UTC; `SeverityNumber` uses OTel numbers (debug 5, info 9, warn 13, error 17); levels info 28,265 · warn 6,080 · debug 3,984 · error 3,191; services 8,064 each except payments 9,264; errors by service auth 384, checkout 445, frontend 373, inventory 414, payments 1,575; incident 2026-01-05 09:00–11:00 (1,200 payments rows, `http.status_code` 503). Latest-5,000 sample: info 3,483 · warn 792 · debug 487 · error 238 (payments-filtered: info 2,667 · error 1,370 · warn 569 · debug 394).

## Now / next
Next: #9 DISC-CHART-01 (histogram) — exact notes in `PROGRESS.md`.
