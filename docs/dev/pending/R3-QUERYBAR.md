# R3-QUERYBAR pending notes

**No SQL generation change.** The edited query reaches `buildWhereConditions` exactly as Discover's does. Untrusted input: `q` from the URL / saved queries is parsed with `parseKql` on the page and an unparseable one never reaches a query (the chart shows an error); a saved query's filters go through `sanitizeFilterPills` and `mergePinnedFilters`. No user text is concatenated into SQL.

## CHANGELOG

### Added
- **Visualize has Discover's query row (R3-QUERYBAR).** Add filter, the query menu (Clear all, load saved query, pin / negate / disable all), and the KQL search bar with autocomplete sit under the toolbar, above the filter pills. Typing changes nothing until Enter; the query goes to the shared `q` URL param (one history entry) and the chart re-runs once. An invalid query shows the error in the bar and in place of the chart.

### Changed
- The read-only query / filter-count summary in the Visualize toolbar is removed (the bar shows the query).

## Decision

The row is `src/lens/QueryRow.tsx`, composing `AddFilterPopover`, `QueryMenu` and `SearchBar` like `LogsExplorer`; `SearchBar` reads fields from `FieldsContext`, so the page wraps it in the provider with its own discovery result. Submits push a history entry (`replace: false`), as filter changes already do. `invalidQuery` is the bar's parse error, `urlQueryError` re-parses `q` from the URL; either one stops the chart query and layer queries, and disables Save. Clear all and a loaded saved query are single URL updates.

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/lens/__tests__/queryRow.test.tsx` (submit only on Enter, invalid query, Add filter opens, `withQuery` URL write) |
| E2E | `tests/features/r3-querybar.spec.ts` — not run (coordinator) |
| E2E | `tests/features/lens-dataview.spec.ts` (carried query read from the search bar) — not run (coordinator) |

## Deferred

- Refresh interval / time shorthand input are not added to Visualize's toolbar.
- Pins: Clear all removes every filter from the URL like Discover; pinned filters return from storage on the next entry.
