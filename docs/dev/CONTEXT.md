# Context snapshot — read this to restart

Saved after every feature (and every review-fix round). A new session can resume from this file plus `PROGRESS.md` alone.
Last saved: 2026-11-18, #24 LENS-DIM-04 merged (PR 20, v0.29.0).

## Goal
Bring Kibana Discover + Lens style exploration to Grafana on ClickHouse by extending the **ClickHouse Observe** app plugin.
- Spec (source of truth): `docs/spec/` (split from the shared doc https://claude.ai/artifact/7qsfKJMZFjx5RpYK5iF67B). Feature IDs like `DISC-SIDEBAR-02`.
- Order: the spec's Development priority table (importance 5 → 1), tracked in `docs/dev/PLAN.md`. ES|QL out of scope (KQL/Lucene-style only).
- Every feature: tests for its acceptance criteria + integration tests with already-built features (`docs/dev/TESTING.md` matrix).
- Hebrew executive summary (separate, for stakeholders): https://claude.ai/artifact/PaGmHQ6nmh3ccLfmWYFbL9

## Working agreements (from the user)
- Fork `ArielShaharabani/clickhouse-observe-grafana` (upstream PoorTuna is read-only). One branch + PR per feature; merge (squash) once gates pass and `/code-review` findings are fixed.
- Checkpoint (PROGRESS + push) at every step; save this CONTEXT file after every feature, every important step and periodically (user: "save your context every once in a while and after every important step"). The user watches `/usage` and says "stop" near 80% → commit `wip:`, push, end.
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
| 9 | DISC-CHART-01: right-click bucket actions (filter by time, filter selected series), range caption | 10 | `src/components/BucketActionsPopover.tsx`, `VolumeHistogram.tsx`, `LogsHistogramPanel.tsx` |
| 10 | DISC-DOC-01: pinned fields, Hide null fields, type filter, first/last navigation, field-present action | 11 | `src/components/LogDetailDrawer.tsx`, `src/state/docPins.ts` |
| 11 | LENS-AUTO-01 / LENS-SUGG-01: Visualize page, auto chart from added fields, suggestions strip, dimension groups | 12 | `src/lens/state.ts`, `suggest.ts`, `compile.ts`, `LensPage.tsx`, `render/LensChart.tsx` |
| 12 | LENS-TYPE-01: one-menu chart type switcher with search, keyboard, sub-type | 13 | `src/lens/ChartTypeSwitcher.tsx` |
| 13 | LENS-DIM-01/02: dimension editor (functions, field, percentile, name, top-N size), + Add slots | 14 | `src/lens/DimensionEditor.tsx`, `src/lens/dimensions.ts` |
| 15 | LENS-INTERACT-02 / DISC-CHART-03: Discover ↔ Lens hand-off (popover Visualize, histogram Edit visualization, Explore in Discover with columns) | 16 | `src/lens/handoff.ts`, `LogsExplorer.tsx`, `LogsHistogramPanel.tsx`, `LensPage.tsx` |
| 14 | LENS-INTERACT-01: click-to-filter on custom XY chart, chooser, legend actions, brush, filter pills on Visualize | 15 | `src/lens/render/XyChart.tsx`, `src/lens/FilterChooser.tsx`, `src/lens/LensPage.tsx` |
| 19 | DISC-FILTER-02: Filter builder: range operators, per-type operators, preview | 19 | `src/components/AddFilter/FilterEditForm.tsx`, `src/sql/filters.ts` (`sanitizeFilterPills`, range validation), `buildFilterClause` |
| 24 | LENS-DIM-04: Top values editor: rank by / direction, Other, missing, include / exclude with regex | 20 | `src/lens/compile.ts` (top-values SQL, `regexError`), `src/lens/state.ts` (`TermsDim` options, `cleanTerms`), `src/lens/DimensionEditor.tsx` |

## Key decisions (details in DECISIONS.md)
- Frontend-only; queries via grafana-clickhouse-datasource (`src/data/runQuery.ts`). Plain React + @grafana/ui, no Scenes.
- URL is the shared search context across pages; pinned filters also in per-tab sessionStorage, changed only by explicit pin transitions, tagged with their table.
- One autocomplete service and one action registry for every surface; field names in actions derived from the SQL expression (`fieldLabelFor`).
- Numeric stats: one-pass sample query (D11); `isBreakdownField` is the single breakdown rule; `chooseBreakdown` in LogsExplorer is the single breakdown setter.
- Two `setSearchParams` calls in one handler: the second starts from render-time params and drops the first's change — build one update.
- Popovers inside scrolling columns render in a Grafana `Portal` (position fixed, measured when opened); `autoFocus` doesn't fire inside a Portal — focus the input explicitly (rAF) after opening.
- @grafana/ui `Select` is deprecated (lint warning) — use `Combobox` (label via `Field htmlFor` + `id`; no aria-label prop).
- Field list groups are ARIA regions ("Selected fields", "Popular fields", "Available fields"); row actions appear on hover (hover before clicking in e2e).
- Lens: state = ordered `buckets` + `metrics`; each chart type reads roles from them in order, so a type switch is a re-cap (`switchChart`). SQL in `compile.ts` (top values via `GLOBAL IN` ranked CTE, median = `quantile(0.5)`); rendering only through `src/lens/render/LensChart.tsx` (PanelRenderer). Lens state in URL param `lens` — untrusted: always `sanitizeLens` against discovered fields before compiling; `compileLens` quotes identifiers. Page is a lazy chunk. Bar/line/area are custom-drawn (`XyChart`, marks are role=button with aria-label `x · series: value`, values formatted 9.3K); metric/table/pie use PanelRenderer. Visualize has editable FilterPills on the shared URL `filters`.

## Environment / gotchas
- Clone: `C:\Users\Ariel\clickhouse-observe-grafana-dev`; git identity set locally; `core.autocrlf false` + `core.eol lf` required (else Grafana container fails on CRLF `entrypoint.sh`).
- Stack: `docker compose up -d --build grafana clickhouse`; the Grafana container is named `poortuna-clickhouse-observe-app` (`docker restart poortuna-clickhouse-observe-app` after plugin.json changes); Grafana http://localhost:3000. Restart Grafana after `plugin.json`/provisioning changes.
- Docker VM has ~7.5 GB and the user also runs `tagdemo-es`, `tagdemo-kb`, `demo-metabase`; e2e runs on 1 worker, no retries, 15 s expect timeout. Occasional load timeouts → rerun the failed test before assuming a bug.
- Grafana `IconButton` uses `tooltip` as its accessible name → use `ActionIconButton` for specific names. Detail panel rows have testid `doc-field-row`; open it with the row's "Open detail" button (IconButton names come from tooltips: "Close", "Next log", "Pin field X"). Grid cells have role `cell` and `data-cell="row:col"` (data columns only; the checkbox/expand cells come first); keyboard-focused cell has `aria-selected`. Grafana `Toggletip` hides the rest of the page from the a11y tree while open — close it (Escape) before locating the grid in e2e; open-detail button is named "Open detail". KQL wildcard `*` is a private-use sentinel (`WILDCARD_STAR`) in parsed values.
- Gates: `npm run typecheck && npm run lint && npm run test:ci && npm run build && npx playwright test`; then `/code-review medium master...<branch>`, plus `/security-review` whenever SQL generation changes (it caught a SQL injection via the `lens` URL param in PR 12).

## Fixture facts (`tests/fixture.ts`)
41,520 rows, 2026-01-01..08 UTC; `SeverityNumber` uses OTel numbers (debug 5, info 9, warn 13, error 17); levels info 28,265 · warn 6,080 · debug 3,984 · error 3,191; services 8,064 each except payments 9,264; errors by service auth 384, checkout 445, frontend 373, inventory 414, payments 1,575; incident 2026-01-05 09:00–11:00 (1,200 payments rows, `http.status_code` 503). Latest-5,000 sample: info 3,483 · warn 792 · debug 487 · error 238 (payments-filtered: info 2,667 · error 1,370 · warn 569 · debug 394).

## Now / next
Now (in progress on `feat/lens-save-01`): #16 LENS-SAVE-01 (save to dashboard) — exact notes in `PROGRESS.md`.

## Parallel work (fan-out, from 2026-11-18)
Agents work in git worktrees under `C:\Users\Ariel\co-wt\<id>` on `feat/<id>`, each with its own Grafana container (`co-<id>`, same image and docker network as the main stack, shared fixture ClickHouse) and `GRAFANA_URL` for e2e:
- `disc-time-01` → #17 DISC-TIME-01/02, port 3011
- `disc-filter-02` → #19 DISC-FILTER-02, port 3012
- `lens-dim-04` → #24 LENS-DIM-04, port 3013
Agents do NOT touch the version, CHANGELOG, PLAN/PROGRESS/CONTEXT/DECISIONS/TESTING. They write `docs/dev/pending/<SPEC-ID>.md` (CHANGELOG bullets, decision text, TESTING rows) and open a PR. The coordinator (main session) merges one at a time: rebase, fold the pending file into the docs, bump the minor version, full e2e on the main stack, `/code-review medium`, squash-merge. If a session ends: `git worktree list`, `gh pr list`, and continue each branch.
Status 2026-11-18: PR 18 (#17 time; docs folded, 0.27.0), PR 19 (#19 filter builder), PR 20 (#24 top values) open on the fork; code-review fixes in progress by the agents; security review for 19/20 running. `gh repo set-default` now points at the fork (agents had opened upstream PRs #26/#27/#28 by mistake; all closed). Merge order: 18 → 19 → 20 (each later one rebases, bumps 0.28.0 / 0.29.0 and folds its pending file with the coordinator script).
Update 2026-11-18 (after a PC restart): Docker restarted, all containers resumed (`docker start` the stack + `co-*`). Interrupted lens-dim-04 review fixes pushed as a `wip:` commit. Second wave added:
- `disc-chart-02` → #18 DISC-CHART-02, port 3014
- `disc-doc-02` → #20 DISC-DOC-02, port 3015
New containers: `docker run -d --name co-<id> --network clickhouse-observe-grafana-dev_default -p <port>:3000 -v <wt>/provisioning:/etc/grafana/provisioning -v <wt>/dist:/var/lib/grafana/plugins/poortuna-clickhouse-observe-app` + the GF_* env of the compose `grafana` service + `GF_PLUGINS_ALLOW_LOADING_UNSIGNED_PLUGINS=poortuna-clickhouse-observe-app`, image `clickhouse-observe-grafana-dev-grafana`.
Then merge order: 18 → 19 → 20 → chart-02 → doc-02.
Status 2026-11-18 (later): PR 18 merged (v0.27.0; gates 930 jest, 79 e2e). Agents hit the 5-hour usage limit once and were resumed. Next: PR 19 → 0.28.0, PR 20 → 0.29.0, then chart-02 / doc-02 PRs.
- 2026-11-18: four parallel e2e suites pushed each worktree Grafana to ~1.3 GB and crashed the Docker engine (VM 7.5 GB). Rule since then: every playwright run takes the lock `mkdir C:/Users/Ariel/co-wt/.e2e-lock` (atomic; wait + retry if it exists) and `rmdir`s it after, pass or fail. Stale lock after a crash: remove it by hand. Merged worktree containers (`co-disc-time-01`) stay stopped. Docker recovery: kill Docker Desktop, `wsl --shutdown`, relaunch, `docker start` the stack + `co-*`.
- User decisions 2026-11-18: #21 DISC-PATTERNS-01 skipped (not a focus); #23 LENS-DIM-03 formula editor lowered to importance 2 (nothing depends on it), now after #25 in PLAN.
- 2026-11-18: PR 19 merged (v0.28.0; 1,003 jest, 98 e2e). Coordinator fold is now `python scripts/dev/fold-pending.py <SPEC> <row> <PR> <version> "<title>" "<key files>"` run in the feature worktree after merging master. User added importance-4 gaps 16b/16c/16d (PLAN). Agent `lens-dataview` (16b + 16c) on port 3012 (`co-lens-dataview`); 16d waits for the next free slot. Merge order now: 20 → chart-02 → doc-02 → lens-dataview.
- 2026-11-18: PR 22 (#18 DISC-CHART-02, UI only) and PR 23 (#20 DISC-DOC-02, new `context/<view>/<ns>_<id>` page) open, agents done. Agent `dataview-time` (#16d) on port 3011; PR 18 worktree/container removed. SECURITY: pre-existing SQL injection via URL `cols` (urlState.ts → LogsExplorer initial state → queryBuilder.ts `${col.sqlExpr} AS ${col.key}`); fix branch `fix/url-cols-sanitize` (based on PR 23, port 3016) in progress, merge it right after PR 23. Merge order: 20 → 22 → 23 → url-cols fix → lens-dataview → dataview-time.
- 2026-11-18 (new session): coordinator resumed, PR 20 full e2e running under the lock. Third wave of agents (each finishes, pushes, opens a fork PR, never merges): `fix-url-cols` (security, port 3016, PR after 23), `lens-dataview` (#16b/#16c, 3012), `dataview-time` (#16d, 3011), new `disc-fieldstats-01` (#22 DISC-FIELDSTATS-01, worktree `co-wt/disc-fieldstats-01`, port 3017). Merge order: 20 → 22 → 23 → url-cols → lens-dataview → dataview-time → fieldstats.
- 2026-11-18 (later): PR 20 merged (v0.29.0; 1,030 jest, 105 e2e). PR 22 folded to 0.30.0 in its worktree (gates green, 1,040 jest) — full e2e NOT run yet (Claude Code reaped it for low host memory). PR 24 = url-cols security fix (gates + 91 e2e green, merge after 23, fold `pending/URL-COLS.md` by hand as patch). PR 25 = lens-dataview #16b/#16c (gates green, e2e pending on port 3012). dataview-time and disc-fieldstats-01 agents still running. Host memory is the bottleneck: stop finished worktree containers; run e2e one at a time. Follow-up to queue: `buildColumnsQuery` interpolates database/table names into the system.columns query unescaped (flagged by lens-dataview).
- 2026-11-18 (later): all third-wave agents done. Open PRs, none merged, full e2e still owed on each (host memory reaped the runs): 22 (chart-02, folded 0.30.0, port 3014) → 23 (doc-02, 3015) → 24 (url-cols security, 3016, patch) → 25 (lens-dataview #16b/c, 3012) → 27 (dataview-time #16d, 3011; also escapes db/table names in introspection; conflicts expected with 24 in queryBuilder.ts/surrounding.ts; `spec_logs_epoch` fixture already loaded) → 26 (fieldstats #22, 3017; based on 0.28.0). Idle worktree containers stopped to save memory; `docker start co-<id>` before its e2e. Run only ONE Grafana worktree container at a time.
- 2026-11-18: fourth wave (no containers, no playwright; coordinator runs their e2e at merge): `shared-perf-01` (#25 SHARED-PERF-01) and `lens-dim-03` (#23 formula editor), worktrees under co-wt/. They queue after PR 26.
