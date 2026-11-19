# PARITY-FIELDS pending notes

**SQL impact.** (1) Map-key discovery now also runs at field discovery (`buildMapKeysQuery`, no conditions, latest 500 rows, one query per Map column, at most 6 columns, concurrency 4, failures ignored). (2) New `buildTimeBoundsQuery`: `SELECT toUnixTimestamp64Milli(toDateTime64(min(ts),3,'UTC')) AS lo, ... max ... FROM db.table` with the query timeout settings, run only when the user clicks "Search entire time range"; `ts` is `timeExpr(config)`, identifiers quoted by `tableRef`. (3) Field statistics: columns profile `toString(x)` (NULL = missing, `''` counts) instead of `ifNull(..., '')` + `notEmpty`; time fields add `minIf` / `maxIf` over the text value; Map keys unchanged. (4) `buildWhereConditions` / surrounding documents go through the new `buildFilterConditions`: OR groups become `((clause) OR (clause))`; every clause still comes from `buildFilterClause`. Untrusted input: `group` / `groupOp` of a pill (URL, saved query, pins) are sanitized in `sanitizeFilterPills` (`^[A-Za-z0-9_-]{1,32}$`, `or` / `and`; a bad id drops both). No security review needed beyond the usual.

## CHANGELOG

### Added

- **Map keys as fields (Kibana parity).** Keys of `ResourceAttributes`, `LogAttributes`, `ScopeAttributes` (and any Map column) are ordinary fields (`ResourceAttributes.host.name`) in the field sidebar, the Add filter field picker and the Field statistics tab; capped at 100 keys per column.
- **Empty results help.** "No results match your search criteria" with tips and a "Search entire time range" button; the empty histogram is hidden.
- **Filter groups and bulk menu.** Pills can be grouped with OR (or AND); a ⋮ menu next to the pills offers Enable all, Disable all, Pin / Unpin all, Invert inclusion and Remove all.
- **Unknown field warning.** `nosuchfield : x` warns that the field is not in the data view.

### Changed

- **After a failed or invalid query the previous rows are no longer shown**; the error replaces them.
- **Field statistics:** empty strings count as "(blank)" values; time fields show an earliest / latest range.

## Decision

PARITY-FIELDS. (1) **Map keys published into `fields`** (reversing the earlier "keys stay on demand" rule): a separate Phase D in `useFieldDiscovery`, after columns / tuples / JSON, never blocking, unfiltered latest-500-rows sample so the list does not change with the search; sorted then capped (100 per column, 6 columns). Bare-name resolution still excludes Map fields (`byName`), so KQL needs the `Column.key` form as before. The container row and the filter-scoped key popover stay. (2) **Groups are one level**: a pill field `group` + `groupOp`, not a tree; OR groups combine into one condition at the position of the first enabled member; AND groups are display-only. Members are kept adjacent by the helpers, so rendering is a run of same-group pills. Grouping is done from the pill menu ("Group with next filter") rather than drag and drop. (3) **Stale results**: a failed list query clears `rows`; a syntax error refused by the search bar sets `invalidQuery` and the grid is replaced by the error (rows are kept underneath and return when a valid query is committed). The histogram is not marked stale. (4) **Entire time range** ends 1 s after the latest event (picker precision). (5) **Blank values**: only for real columns; for Map keys ClickHouse returns `''` for an absent key so "empty" stays "missing".

## TESTING

| Area | Row |
| ---- | --- |
| PARITY-FIELDS | jest `src/sql/__tests__/parityFields.test.ts` (blank / time-range stats SQL + parse, unknown KQL fields, time bounds SQL, filter group SQL, helpers, sanitize) and `src/components/__tests__/parityFields.test.tsx` (SearchBar warning + invalid callback, NoResults, pill groups, bulk menu); `FieldsContext.test.tsx` (Map keys published, sorted, capped, failures ignored) |
| PARITY-FIELDS | e2e `tests/features/parity-fields.spec.ts`: not run (coordinator) |

## Deferred

- Mark the histogram stale after an invalid query; drag-and-drop grouping; nested groups.
- Map-key fields are an unfiltered sample: keys absent from the latest 500 rows are not listed (typing `Col.key` still resolves).
