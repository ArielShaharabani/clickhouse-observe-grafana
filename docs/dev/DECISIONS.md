# Architecture decisions (append-only)

## D1 — Extend ClickHouse Observe instead of a new plugin (2026-11-17)
v0.10.0 already implements most of Discover on ClickHouse (KQL → SQL with autocomplete, filter pills, field sidebar + stats popover, histogram + breakdown, grid with cell actions, detail drawer, diagnostics). Build Lens and the gaps on top. Spec: `docs/spec/80-blueprint.md`.

## D2 — Frontend-only, queries through grafana-clickhouse-datasource
Keep using `src/data/runQuery.ts` (`getDataSourceSrv().get(uid).query()` with `{rawSql, editorType:'sql', format:1}`). The repo removed its Go backend in 0.4.7. Add a backend only if pattern clustering needs it.

## D3 — Plain React + @grafana/ui, no Scenes migration
Migration cost outweighs the benefit; the app already has its own state + URL sync.

## D4 — Lens rendering
- Bar / line / area (the default auto charts): custom-drawn, generalising `VolumeHistogram.tsx`, because Grafana panels give no one-click "point clicked" callback and the spec requires one-click filter + the multi-dimension "Select filters to apply" chooser.
- Table, Metric/Stat, Pie, Heatmap: `PanelRenderer` (`@grafana/runtime`, public but `@internal`) inside `PanelContextProvider` (`@grafana/ui`, alpha) for table cell filters (`onAddAdHocFilter`) and brush (`onChangeTimeRange`). Isolated in `src/lens/render/` so a Grafana API change touches one place.

## D5 — Deterministic fixture for tests
`default.spec_logs` (`scripts/clickhouse-init/04_spec_fixture.sql`): fixed window 2026-01-01..2026-01-08 UTC, no TTL, 41,520 rows incl. a payments incident on 2026-01-05 09:00–11:00. Tests assert exact counts from `tests/fixture.ts`, never the Kibana numbers in the spec.

## D7 — URL is the shared search context; pinned filters also in session storage (SHARED-STATE)
Every page reads/writes the same URL params (`q, filters, cols, sort, from, to, ds, interval, bd`), like Kibana's `_g`/`_a`, so hand-offs between pages are just links built by `buildAppPageUrl` (`src/state/sharedSearch.ts`). Pinned pills (`FilterPill.pinned`) are also kept in per-tab session storage (`clickhouse-observe.pinnedFilters`), each with the table it was pinned on. The store changes only on explicit transitions (pin, unpin, edit/exclude of a pinned pill, delete of a pinned pill); disable and Clear all are page-only. Pin flags are shown only for conditions in the user's own store (foreign links/saved searches can't plant pins). Pins merge into pages opened without `filters`, loaded saved searches and data view switches — disabled on a view reading a different table. A field breakdown is stored by `FieldModel.id` and resolved once discovery finishes. No React context store was added: LogsExplorer already owns its state and the Lens page will decode the same URL.

## D8 — One autocomplete service for every input (SHARED-AUTOCOMPLETE-01)
`src/autocomplete/service.ts`: `useAutocompleteSources({config, query, timeRange, fieldIndex})` gives `loadValues`/`loadMapKeys` scoped to the time range, search and filters; lookups never reject or throw (failures resolve empty; an unparsable search is dropped from the scope), the scope is compiled once per change, and the cache key distinguishes before/after field discovery. `rankFields(fields, prefix, {allow})` (`src/autocomplete/rankFields.ts`, pure) is the one field ranker: name or display name, prefix-first; the KQL suggestion engine uses it too. New inputs (filter builder, Visualize field pickers, formula editor) must use it — checklist in `docs/spec/30-shared.md`.

## D9 — Dirty state only for the query (DISC-SEARCH-02 / DISC-TIME-02)
Grafana's time picker applies a range immediately (no pending state), so only the KQL bar has a dirty state: when the typed query differs from the committed one, its search icon becomes a primary "Update" button. Matched-term highlighting (`src/sql/kql/highlight.ts`) mirrors the SQL that matched (toSql): fields resolve via `resolveField`, field wildcards expand against discovered fields, an unresolvable `field:value` is a body match on its raw text, wildcard values are one ordered pattern, phrases match on word boundaries; negated/exists/range terms and raw-SQL mode get no highlights. One compiled matcher per column.

## D10 — Action registry (SHARED-ACTION-01)
`src/actions/registry.ts` defines each value/field action once (icon, short tooltip, specific accessible name, compatibility, behaviour): `valueActions(ctx, host, ids?)` → filter for / filter out / copy; `fieldActions` → exists / does not exist. A surface passes an `ActionHost` (`addFilter` omitted = read-only → copy only) and keeps its own layout. Grafana's `IconButton` uses `tooltip` as its accessible name, so icon surfaces use `ActionIconButton` (Tooltip wrapper) to keep names like "Filter for Service: payments". The field list's "filter out rows that have this field" is now a `not_exists` pill (same SQL as the old `= ''`).

## D15 — Document flyout (DISC-DOC-01)
Pinned fields are per browser tab (sessionStorage `clickhouse-observe.pinnedDocFields`, keyed by SQL expression) and sort to the top in pin order across documents. "Hide null fields" hides empty and `null` values. The field-name action is the registry `exists` action. Navigation stays page-scoped ("3 of 50", plus first/last). Permalink and "View surrounding documents" wait for DISC-DOC-02 (#20).

## D14 — Histogram bucket actions (DISC-CHART-01)
Right-click on a bar opens a pinned popover (`BucketActionsPopover`): "Filter by time" zooms to that bucket, "Filter N selected series" adds one pill — `=` for one series, `one_of` for several (separate `=` pills would AND to nothing). The synthetic "other" rest-series of a field breakdown is never offered. Left-click behaviour (brush / segment popover) is unchanged; Ctrl+click (macOS right-click) never starts a brush. The popover is keyed by bucket start time (a refresh can't retarget it), stays on screen, and month/year buckets end at the next calendar boundary (`bucketEnd`). The two chart popovers still have separate shells — merge them if a third appears. Deferred: "now" line and partial-bucket shading.

## D13 — Field list groups (DISC-SIDEBAR-01)
Groups: Selected, Popular, Available. Popular = up to 5 fields used from the list (added as a column or filtered on), counted per viewer and table in localStorage (`src/state/fieldUsage.ts`); they're listed once (not again under Available). Only fields that are rows of the list count (drilled Map keys don't), ineligible ids are dropped before the top-5 cut, and in-memory counts keep working when storage is blocked. Counts are per table (the source config has no data-view id). The type filter resets when the table changes. No Empty group: telling empty from available needs a per-field existence query, which the perf plan removed; revisit with SHARED-PERF-01. No Meta group (ClickHouse has no `_id`/`_index`). Type filter counts follow the name search.

## D12 — Grid keyboard model and Expand (DISC-TABLE-01/02)
Roving focus is per cell (`data-cell="row:col"`, `aria-selected`), not per row. Enter opens the cell's Expand popover as the spec says; Shift+Enter opens the row's detail drawer (what Enter used to do; also on the "Open detail" button). A mouse click focuses the clicked cell, but the action bar follows the keyboard cursor only while the keyboard drives the grid. PgUp/PgDn are taken only when the page really changes (one step at a time). Expand pretty-prints JSON text by re-indenting it, never re-serializing (UInt64 IDs keep every digit). Expand is a registry value action (`expand`, shown only when the host provides it), so its popover's buttons are the same Filter for / Filter out / Copy as everywhere. Display options (density, body lines; default Normal / 3) are a per-viewer convenience in localStorage, not URL state. Summary column and sample size are deferred: the OTel Body column already plays the summary role and the grid pages on demand.

## D11 — Field stats popover sampling (DISC-SIDEBAR-02)
The popover samples the 5,000 most recent matching rows (`STATS_SAMPLE_SIZE`); autocomplete keeps 500 (`DEFAULT_SAMPLE_SIZE`) to stay light; the shared cache key includes the sample size. Numeric fields get min / median / max + 10 equal-width buckets in one query (`buildNumericStatsQuery`) that reads the sample once (`groupArray` + `arrayCount`), so summary and buckets describe the same rows even with timestamp ties, and the division is guarded inside `floor` (constant fields can't hit NaN). Which fields can split the histogram is one predicate, `isBreakdownField` (scalars, not Map/JSON/Tuple/Array), shared by the toolbar picker and the popover. The fixture's `SeverityNumber` uses OTel severity numbers so numeric stats are testable. Breakdown and Visualize are registry field actions shown only when the host provides them.

## D6 — Work in a fork, PR per feature, auto-merge on green
Fork `ArielShaharabani/clickhouse-observe-grafana` (no push access upstream). One branch + PR per feature, merged once all gates pass.
