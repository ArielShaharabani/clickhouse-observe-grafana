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
Every page reads/writes the same URL params (`q, filters, cols, sort, from, to, ds, interval, bd`), like Kibana's `_g`/`_a`, so hand-offs between pages are just links built by `buildAppPageUrl` (`src/state/sharedSearch.ts`). Pinned pills (`FilterPill.pinned`) are also kept in per-tab session storage (`clickhouse-observe.pinnedFilters`). The store changes only on explicit pin/unpin/delete (`pinFilterInStore`/`unpinFilterInStore`). Pins are merged only into pages whose URL has no `filters` param (a shared link with filters reproduces exactly what the sender saw), into loaded saved searches, and into a data view switch — disabled when the new view reads a different table (their SQL expressions may not exist there). A field breakdown is stored by `FieldModel.id` and resolved once discovery finishes. No React context store was added: LogsExplorer already owns its state and the Lens page will decode the same URL.

## D8 — One autocomplete service for every input (SHARED-AUTOCOMPLETE-01)
`src/autocomplete/service.ts`: `useAutocompleteSources({config, query, timeRange, fieldIndex})` gives `loadValues`/`loadMapKeys` scoped to the time range, search and filters; lookups never reject or throw (failures resolve empty; an unparsable search is dropped from the scope), the scope is compiled once per change, and the cache key distinguishes before/after field discovery. `rankFields(fields, prefix, {allow})` (`src/autocomplete/rankFields.ts`, pure) is the one field ranker: name or display name, prefix-first; the KQL suggestion engine uses it too. New inputs (filter builder, Visualize field pickers, formula editor) must use it — checklist in `docs/spec/30-shared.md`.

## D6 — Work in a fork, PR per feature, auto-merge on green
Fork `ArielShaharabani/clickhouse-observe-grafana` (no push access upstream). One branch + PR per feature, merged once all gates pass.
