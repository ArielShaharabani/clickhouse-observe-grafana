# PERF-METADATA pending notes

**This change touches SQL generation** (`src/sql/introspection.ts`, `src/sql/keys.ts`): the unfiltered Map-key sample that feeds the field list now carries a time bound (`buildDiscoveryWindowConditions`: `<time> >= $__fromTime AND <time> <= $__toTime` plus the existing coarse partition predicate; sparse-key fallback `<time> >= $__toTime - INTERVAL 7 DAY AND <time> <= $__toTime`, and the partition column with 8 days). The time expression comes from `timeExpr(config)` and the partition column from the view mapping (both trusted, already escaped); no user text is added to SQL. Settings fragments and Map-column escaping are unchanged.

## CHANGELOG

### Fixed
- **Faster page load.** Discover and Visualize no longer repeat schema queries: `system.columns`, JSON-path discovery and Map-key samples run once per table and are shared by every part of the page (cached for the session, cleared by the field list's refresh). The default view's schema is not read when the link names another view. The Map-key samples that fill the field list read only the current time range (widened to 7 days only when nothing is found) instead of the whole table.
- The trace-link probe (`SELECT '' AS traceID`) now runs only when a trace link is first needed (opening a document with a trace id), not on every page load.

## Decision

PERF-METADATA. One metadata layer (`src/sql/metadataCache.ts`): an in-flight promise cache keyed by datasource + database + table + kind (+ JSON column), 10 min TTL, rejections never cached, `invalidateMetadata` on refresh. Cause of the duplicates: App.tsx ran a full `useFieldDiscovery` for the active view for the prune-column detection while LogsExplorer / LensPage ran the same discovery again (two independent per-hook caches that raced; map keys were also keyed by a time bucket that differed between the two). App now calls it with `columnsOnly` (columns + prune detection, no JSON/Map, no re-run on time change) and the page owns the field lists; both share one `system.columns` through the metadata layer. App's initial active view honours a `ds` URL param that names a known view, so the default view's schema is never fetched first. `SELECT '' AS traceID` is the probe that reads the "View trace" data-link template the ClickHouse datasource attaches to a column named `traceID`; it is needed only to build trace links in the detail drawer, so it is now lazy (first `getTraceHref` call). JSON paths were deliberately left unfiltered: `buildJsonPathsQuery` relies on ClickHouse 25.12+ answering `distinctJSONPaths` from part metadata only when the query has no WHERE (a filter was measured 5x slower), so bounding it would trade a fast path for a slow one on current servers; the duplicate is removed instead (2 -> 1).

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/components/__tests__/perfMetadata.test.tsx` (query counts per bootstrap with two concurrent consumers, metadata cache sharing / invalidation / no cached rejection, map-key samples time-bounded, sparse-key fallback) |
| E2E | `tests/features/perf-metadata.spec.ts` (query count per Discover / Visualize load) — not run (coordinator) |

Expected queries per load (perf-50m, 3 Map columns, 1 JSON column): before 11-15 (system.columns x4, distinctJSONPaths x2, map samples x6, traceID probe, plus page queries); after about 8-9 (system.columns x1, distinctJSONPaths x1, map samples x3, plus the page's logs/volume queries; probe only on demand).

## Deferred
- JSON-path discovery stays unbounded (see Decision); a time-bounded variant needs a measurement on a pre-25.12 server and on perf-50m.
- `CreateDataViewModal` / `TimeFieldSelect` still issue their own `system.columns` (wizard-only, not part of page load).
