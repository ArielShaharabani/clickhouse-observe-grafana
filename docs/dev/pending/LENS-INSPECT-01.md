# LENS-INSPECT-01 pending notes (#29)

**No SQL generation changed.** The Inspector reads the chart's existing result and the diagnostics tracer's spans; the only new query-adjacent code is the cell filter, which goes through the shared action registry (`makeFilter`), like every other Filter for / out.

## CHANGELOG

### Added
- **Inspector on Visualize** (#29, LENS-INSPECT-01; spec 20-lens.md "Inspector"). An `Inspect` button in the Visualize toolbar opens a right drawer with `View: Data | Requests`.
  - **Data:** the chart's table (bucket columns then one column per metric), sortable headers (ascending → descending → off, `aria-sort`), 20 rows per page, ⊕ / ⊖ on top-values cells through the shared action registry (same names and pills as everywhere else; the synthetic "Other" / "(missing)" buckets and date buckets have none), and `Download CSV ⌄` Formatted (as shown: local date-times, grouped numbers) or Raw (as returned).
  - **Requests:** "1 request was made", the latest chart query from the diagnostics tracer (the same spans as Discover's Diagnostics drawer) with duration and ClickHouse query id; tabs Statistics (Hits, Rows read, Bytes read, Data view, Data view ID, Table, Query time, Query time (ClickHouse), Memory usage, Request timestamp, Status — server numbers appear once `system.query_log` enrichment lands), Request (the SQL, plus the post-macro SQL when it differs) and Response (columns + first 100 rows), each with Copy.

### Security
- CSV export never writes a log value a spreadsheet would run as a formula: text starting with `= + - @`, tab or CR is prefixed with `'` (CSV injection); fields are RFC 4180-quoted. File names are reduced to `[A-Za-z0-9_.-]`.

## Decision

LENS-INSPECT-01. Visualize gets its own Inspector rather than the Discover Diagnostics drawer: the spec's Data view (the chart table with filter actions and CSV) has no Diagnostics counterpart, and the Requests view only needs Visualize's chart query. The Requests view reads the tracer (`useDiagnostics`, roots of kind `lens`) instead of new state in LensPage, so the chart query effect is untouched and the server statistics come from the existing `system.query_log` enrichment. Kibana's "Clusters and shards" tab has no ClickHouse equivalent and is left out; its read rows / bytes / memory are in Statistics instead. Cell filter values follow compile.ts's `termCell` labelling: a cell equal to an enabled synthetic label is not filterable, and the `" (value)"` spelling of a clashing real value maps back to the value. A real value literally spelled `Other (value)` while "Other" is on would map to `Other` (labels are ambiguous there; same limitation as the legend filter). Date-bucket cells get no filter action (a bucket is a range; the chart's own brush / bucket menu sets the time). Files: `src/lens/Inspector.tsx` (UI), `src/lens/inspectorData.ts` (pure helpers; not `inspector.ts` — Windows file names are case-insensitive), LensPage wiring (button + drawer, no query changes).

## TESTING

| Case | Status |
| --- | --- |
| Table columns / roles, cell filter values (synthetic and "(value)" spelling), sorting with empty cells last, CSV quoting + formula-injection prefix, raw vs formatted CSV, safe file name (jest `inspector.test.tsx`) | ✅ |
| Inspector UI: 20 rows per page, sort toggles `aria-sort`, Filter for / out add `=` / `!=` pills, no actions on metric cells; Requests view shows only `lens` roots with Hits / Rows read / Data view and the SQL / response tabs; empty states (jest `inspector.test.tsx`) | ✅ |
| E2E: Inspect on a top-values bar → table rows match the fixture, sort by count, Filter for payments adds the pill + URL filter and the table re-runs; Download Raw CSV content; Requests view Hits 5, Table, Status, SQL, response (`tests/features/lens-inspect-01.spec.ts`) | written, not run (coordinator) |
