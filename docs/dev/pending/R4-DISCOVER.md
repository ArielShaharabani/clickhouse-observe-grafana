# R4-DISCOVER: Discover round-3 rows 1-4, 9, 10, 12-14

SQL impact: one new query, only for data views without a time field: `SELECT count() AS count FROM <table> [WHERE search/filters]` (replaces the "200 rows loaded+" footer; no histogram). Fewer queries elsewhere: the windowed document search now makes at most 3 steps (was 4), and an empty Map column is no longer sampled again (see Decision).

## CHANGELOG
- Discover: a data view with no mapped columns (e.g. no time field) opens with a Summary column (`key: value` of every field) instead of blank rows.
- Discover: data views without a time field show the matching count ("200 of 41,520 loaded", Load all) from one count query.
- Discover: the document panel overlays the grid (Kibana flyout) instead of squeezing it; grid, Message column and pager stay intact.
- Discover: the Message column no longer overlaps an added column at 1440 px (minimum width now on the cell).
- Discover: fewer queries on load with a search: windowed document search is at most 3 steps; empty Map columns are sampled once.
- Histogram tooltip reads "Count of records N".
- Single-document permalink is shorter: the time range travels only inside `ret`. Old links still open.
- Field sidebar default width 24 % (min 240 px) so long names fit.
- A link naming a personal data view missing from this browser shows a warning instead of silently opening another view.

## Decision
- Row 1: client-side Summary (rows already carry every field via the `SELECT *` fallback), no SQL change. It is not sortable, filterable or removable; adding any column replaces it.
- Row 3: overlay is not resizable any more (the detail splitter and its `detailSplit` localStorage key are gone); width 45 % (min 400 px), 88 % when expanded.
- Row 9: could not run the app. Reading the code, the extra queries with `q=` are (a) windowed search steps (1 h, 6 h, 36 h, full) because a selective search fills the page late, and (b) the key sample retrying wider windows for an empty Map column. Cut step count to 3 and retry only when the first window held no rows (straight to the widest window). The post-discovery reconcile already re-runs only when SQL differs. Expected saving 2 queries; the coordinator should recount (target still above Kibana's 4).
- Row 12: `ret` already holds from/to; if it does not, the link keeps its own from/to. Link is now roughly 120-130 chars with a typical `ret`, not Kibana's 77 (the return context is kept).
- Row 13: widened the default; saved user splits are unchanged.
- Row 14: notice only (data views stay in localStorage).

## TESTING
- jest: windowedSearch, keys fallback, buildCountQuery, LogsTable Summary, parity_grid permalink.
- e2e `tests/features/feat-r4-discover.spec.ts`: overlay keeps grid width; missing data view notice. not run (coordinator).
- Manual/e2e to add by the coordinator: no-time view shows Summary + total; 1440 px added column does not overlap Message; query count with `q=`.

## Deferred
- Query count with `q=` not measured; may still exceed Kibana's 4.
- Documents tab label "Documents (N)" not added; the footer carries the count.
