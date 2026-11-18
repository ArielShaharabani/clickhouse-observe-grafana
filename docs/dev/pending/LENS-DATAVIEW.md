# LENS-DATAVIEW pending notes (#16b + #16c)

**No SQL generation changed.** Queries are built exactly as before; what changed is which view / fields Visualize compiles against and when. Stored session context is untrusted and goes through `decodeLogsState` (filters via `sanitizeFilterPills`, time validation, unknown views dropped).

## CHANGELOG

### Added
- **Data view picker on Visualize** (#16b, LENS-AUTO-01 gap; spec 20-lens.md "Search bar: Data view …"). The same picker as Discover sits in the Visualize toolbar. Switching keeps the query and time; the chart keeps only dimensions on fields the new view has (re-validated with `sanitizeLens` once that view's fields are discovered, and written back to the URL); filters follow D7 — pinned pills are enabled only on the table they were pinned on, other pills arrive disabled on a view of a different table (kept as-is on a view of the same table). The URL now always names the view (`ds`), so Explore in Discover and reloads land on it.
- **Visualize applies the URL's data view** (`ds`), like Discover; it used to chart whatever view was last active.
- **Pinned filters on Visualize** (D7): a Visualize URL without `filters` gets the stored pins, like Discover.
- **"Explore in Visualize" button in the Discover toolbar** (#16c). Same link as the histogram's Edit visualization (Bar over time with the current breakdown), or an empty workspace for a view without a time field; carries query, filters, time (relative stays relative) and data view.
- **Visualize opened without a search context** (Grafana's side-menu entry is a static link) restores the tab's last query, filters, time and data view (session storage `clickhouse-observe.lastSearch`, written by Discover and Visualize), then the view's draft chart.

### Changed
- `useFieldDiscovery` also returns `fieldsFor` (the `discoveryKey` of the table `fields` belong to); Visualize waits until it matches the active view, so a switch never compiles the new table with the previous table's fields.
- The Lens draft is saved only once the view's fields are in (sanitized chart), never mid-switch.

## Decision

LENS-DATAVIEW (#16b / #16c). Visualize opens through one pure function, `visualizeEntry` (`src/lens/entry.ts`): (1) no search context in the URL (`q`, `filters`, `from`, `to`, `ds` all absent) → the tab's last context from session storage, re-encoded through the URL codec; (2) the view = the URL's `ds` if it names a known view, else the active view, and `ds` is always written; (3) no `filters` → stored pins merged (D7); (4) no `lens` → the draft for that view's datasource + table. Everything lands in ONE `setSearchParams` (two in a row drop each other's change). Until the entry view is active and its fields are discovered (`fieldsFor === discoveryKey(config)`), nothing compiles and no draft is saved. A switch on the page is an effect on the active view (so the picker, creating a view and deleting the active one all go through it): one URL update writes `ds` and `filtersForViewSwitch` (`src/state/sharedSearch.ts`), then the sanitized chart is written back once the new fields are in. Discover's own behaviour on a switch is unchanged (it still resets query and filters to pins). Plain filters stay disabled when switching back to their table (we do not track which table a non-pinned pill came from); the user re-enables them. Explore in Visualize reuses `visualizeUrl` and the histogram's `lensForHistogram` link. The side-menu entry in plugin.json is unchanged (static); the restore lives in the page. Pre-existing, not changed here: `buildColumnsQuery` interpolates database/table names into the `system.columns` query without escaping (data view config is admin / personal input) — worth a follow-up.

## TESTING

| Case | Status |
| --- | --- |
| IT-G | Discover → Visualize via the toolbar "Explore in Visualize" keeps q, filters, ds and relative time (`tests/features/lens-dataview.spec.ts`) ✅ |
| IT-K | Visualize from a static link restores the tab context (`lens-dataview.spec.ts` side-menu test); a link with its own context wins ✅ |
| Pins (D7) on Visualize | stored pin merged when the URL has no filters; pinned pill disabled on another table and enabled again on its own; plain pill disabled on another table (`lens-dataview.spec.ts`; jest `dataview.test.ts`) ✅ |
| View switch | dimensions on missing fields dropped, query/time kept, chart re-queried against the new table, URL ds applied on load and carried by Explore in Discover (`lens-dataview.spec.ts`) ✅ |
| Discovery | `fieldsFor` keeps the old table's key until the new table publishes (jest `FieldsContext.test.tsx`) ✅ |

## Acceptance

| Criterion | Test / status |
| --- | --- |
| Data view picker in the Visualize search bar | e2e "#16b: Visualize has a data view picker …" |
| Switch keeps query, time; drops fields the view lacks | same e2e; jest `visualizeEntry` / `filtersForViewSwitch` |
| Chart re-queries the new view | e2e "the chart re-queries the new view" |
| Pins follow D7 on a switch | e2e "#16b / D7 …"; jest `filtersForViewSwitch` |
| URL data view applied on Visualize; carried to Discover | e2e "the URL data view applies on Visualize …" |
| Labeled Explore in Visualize on Discover, same context incl. time | e2e "#16c / IT-G …"; jest "Explore in Visualize link" |
| Side-menu Visualize restores the last context | e2e "#16c: Visualize from the side menu …"; jest last-context suite (untrusted input) |
| Side-menu Visualize clicked while already on Visualize | re-enters via the same `visualizeEntry` (effect on an emptied URL); jest covers the function, no e2e (Grafana's nav menu docking varies) |
| Per-layer data view (spec 20-lens.md:13) | gap left: LENS-LAYER-01 (#28) |

## Status (for a resuming session)

Done: implementation (LensPage entry + view switch, `src/lens/entry.ts`, `src/state/lastSearch.ts`, `filtersForViewSwitch`, `fieldsFor` in FieldsContext, Discover "Explore in Visualize" + context memory), jest (`src/lens/__tests__/dataview.test.ts`, FieldsContext fieldsFor tests), e2e spec written (`tests/features/lens-dataview.spec.ts`). Static gates green: typecheck, lint 0 errors, jest 1021/1021.
Next step: `npm run build`, then under the e2e lock run `GRAFANA_URL=http://localhost:3012 npx playwright test tests/features/lens-dataview.spec.ts lens-* shared-state --workers=1` (Grafana `co-lens-dataview`); fix failures that reproduce alone; then open the PR (`gh pr create --repo ArielShaharabani/clickhouse-observe-grafana`).
