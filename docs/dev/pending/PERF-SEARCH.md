# PERF-SEARCH pending notes

**This change touches SQL generation.** No new query text for the list: `buildLogsQuery` is unchanged and runs over a narrowed time range (the `$__fromTime` / `$__toTime` the datasource expands come from a `TimeRange` narrowed to the newest window, `src/data/windowedSearch.ts`). `src/sql/kql/toSql.ts` now emits `lower(<col>) LIKE '<pattern>'` in place of `<col> ILIKE '<pattern>'` when an `ngrambf_v1` index on exactly `lower(<col>)` was discovered; the pattern goes through the same `escapeLike` + `quoteString` path as before, so escaping is unchanged. New read-only query `buildSkipIndicesQuery` (`system.data_skipping_indices`, database/table through `quoteString`). Untrusted input: the KQL text (existing compiler), index expressions/types read from ClickHouse system tables (compared as strings, never interpolated into SQL; only the column expression the compiler already produced is). The coordinator should run the security review.

## CHANGELOG

### Changed
- **Faster document list on long ranges (PERF-SEARCH).** With the default newest-first sort the list searches the most recent hour first and widens (6 h, 36 h, full range) only until the page is full, so a selective filter over 7+ days no longer scans the whole range before showing rows. Same rows, order and paging; the histogram and total still cover the whole range. Other sorts are unchanged.
- **Indexed wildcard search.** If the message column has an `ngrambf_v1` index on `lower(Body)`, `*term*` searches use it (`lower(Body) LIKE '%term%'`). Setup and DDL in `docs/data-view-setup.md`. Without the index nothing changes.

## Decision

PERF-SEARCH (issues #4, #7). Windowing is done by narrowing the time range rather than rewriting SQL: a window is always a suffix of the range, so "window returned `limit` rows" proves they are the newest `limit` rows of the range (also with OFFSET, since the window then holds at least offset+limit rows); fewer rows means widen. Windows 1 h x6 up to 4 queries total with the full range as the last, collapsing when a window would cover half the range or more. Load-more starts from the width that last filled a page. The windows re-scan their overlap (geometric, so at most about 1.2x the final window) in exchange for needing no de-duplication at window edges. Not windowed: non-time and ascending-time sorts, raw SQL, no time field. First window size from the histogram buckets was not done: the histogram runs in parallel and its result is not available when the list starts, and waiting on it would delay the first rows. Text index: only `ngrambf_v1` on exactly `lower(col)` is used, because it is the one form that is row-for-row the same as the current case-insensitive substring match. `hasToken` / `tokenbf_v1` / `text` match whole tokens (`*Timeout*` must also match `ReadTimeoutError`), and an index on the plain column serves case-sensitive LIKE only; both would change results, so they are parsed but unused. The same rewrite applies to bare unquoted terms (also ILIKE substring). Indexes are never created by the plugin.

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/data/__tests__/windowedSearch.test.ts` (window sequence, stop when full, fallback, rows equal full query incl. OFFSET, cancel, sort detection), `src/sql/__tests__/text_index.test.ts` (index parsing, indexed compile, escaping, fallbacks) |
| E2E | `tests/features/perf-search.spec.ts` — not run (coordinator) |

## Deferred

- First window sized from histogram bucket counts (the histogram is not available when the list starts).
- Ascending time sort windowed from the oldest end.
- `tokenbf_v1` / `text` index forms (`hasToken`, `multiSearchAny`) for whole-word searches; they are not equivalent to the substring match, so would need a distinct whole-word operator.
- Index detection is not threaded into dashboard panel export / Visualize / alert SQL (they keep ILIKE).
