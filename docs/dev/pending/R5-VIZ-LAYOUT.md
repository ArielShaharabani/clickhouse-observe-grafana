# R5-VIZ-LAYOUT

SQL impact: none (layout, panel options and breadcrumbs only).

## CHANGELOG

- Visualize: the Fields list and the Dimensions panel are resizable with drag handles (Grafana `useSplitter`, the same as Discover's sidebar); widths persist in localStorage (`clickhouse-observe.lens.fieldsSplit`, `clickhouse-observe.lens.dimsSplit`).
- Visualize: the Table chart paginates (`enablePagination`), in the page and in the exported dashboard panel, so a large table no longer hides its bottom / summary row.
- Discover: the breadcrumb no longer repeats the page name (`Discover > Discover`); the `PluginPage` `pageNav` child was removed so the nav entry is the last crumb.

## Decision

- Fields | (workspace | dimensions) uses two nested splitters; widths are fractions (like Discover), min widths 160 px (fields) and 220 px (dimensions).
- Visualize renders without `PluginPage`, so its crumb is the nav entry only; unchanged.
- Kibana-like: tables paginate.

## TESTING

| Case | Type | Status |
| --- | --- | --- |
| Table panelSpec enables pagination | jest (chartSpecifics) | pass |
| Fields pane resize + persistence, dims handle, breadcrumb | e2e `tests/features/r5-viz-layout.spec.ts` | not run (coordinator) |

## Deferred

- Context / single-document pages keep their own child crumb (distinct names, not duplicates).
