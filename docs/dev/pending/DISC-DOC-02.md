# DISC-DOC-02 pending notes

**This feature changes SQL generation** (`src/sql/queryBuilder.ts`: new `buildSurroundingDocsQuery` (replaces the unused old one), `buildContextAnchorLookupQuery`, `contextIdExpr`; `buildLogDetailQuery` now shares `detailRowConditions`, output unchanged). The coordinator should run the security review. Untrusted input: the anchor in the URL path, URL `filters` / `cols` / `ret`. The anchor is two decimal digit strings validated by `isContextAnchor` (Int64 / UInt64 range, no sign, no leading zero) before it is inlined as a number; malformed anchors produce no query. URL columns are rebuilt from the view mapping / discovered fields by id (`contextColumns`), so a URL `sqlExpr` / `key` never reaches SQL on this page. Filters go through the existing `buildFilterClause`. `ret` is re-serialized as query params under the `logs` route only. Hostile-value tests: `src/sql/__tests__/surrounding.test.ts`, `src/data/__tests__/surrounding.test.ts`.

Found while working (pre-existing, not changed here): Discover itself (`buildLogsQuery`) still puts URL `cols[].sqlExpr` / `key` into SQL verbatim, so a crafted shared link can inject SQL on the logs page. Suggest applying the `contextColumns` approach there too (follow-up).

## CHANGELOG

### Added
- **Surrounding documents (DISC-DOC-02).** "View surrounding documents" in the document detail panel opens `context/<dataViewId>/<docId>` (breadcrumb `Discover / Surrounding documents`, title `Documents surrounding #<id>`): the anchor document highlighted in pale yellow, 5 newer documents above and 5 older below, `Load [5] newer documents` / `Load [5] older documents` with an editable step (up to 500 per side), and a status line ("7 newer documents · no more newer documents"). The search query is dropped; filters come along disabled (struck through) and can be re-enabled; Discover's columns are kept. Documents sharing a timestamp are ordered by a row id, so paging never skips or repeats one. The page is not bound to the time picker. Rows open the same detail panel, where "View surrounding documents" re-anchors on that document; the breadcrumb returns to Discover with its original query and filters.

## Decision

DISC-DOC-02 (surrounding documents). ClickHouse tables have no document id, so a document is identified by its sort values, Kibana-style: (timestamp in epoch nanoseconds, row id), the row id being `cityHash64` of the timestamp and the mapped body / severity / trace id / service columns, the same fields `logRowKey` compares; rows equal on all of them are indistinguishable everywhere in the app anyway (the fixture has none). Both values are 64-bit, so queries return them with `toString` and they travel as decimal strings (a JS number would round them). The two `search_after` searches are tuple comparisons, `(ts, id) > anchor ORDER BY ts, id ASC` and `(ts, id) < anchor ORDER BY ts, id DESC`, each `LIMIT size`, plus a plain `ts >= / <= anchor` bound and the coarse partition bound so ClickHouse can prune parts. The anchor itself is a third exact-match query, so "anchor not found" (deleted, or excluded by a re-enabled filter) gets its own message. "Load N" raises the requested size and re-runs only that side. Opening from Discover first resolves the grid row to its anchor with one point lookup (same match as the detail query); rows on the context page already carry their anchor values (`__ctxNs`, `__ctxId`), so re-anchoring there needs no lookup. The URL carries the anchor in the path (`<ns>_<id>`) and the shared `filters` / `cols` / `from` / `to` plus `ret` (Discover's query string, for the breadcrumb). Filters arrive disabled; disabling never touches the pin store, so pinned filters are still pinned and enabled back in Discover. The time range is carried only for field discovery and the way back; the neighbour queries ignore it. Not done: "View single document" permalink (the context URL already identifies one document), row-level entry from the grid (the detail panel is the spec's entry point), and a hard cap on how far back the older search may scan (on a table whose sort key does not start with the timestamp an older search on a sparse filter can read many parts; `max_execution_time` still applies).

## TESTING

| Area | Row |
| --- | --- |
| IT-I | Drawer → surrounding documents: filters disabled, query dropped, columns kept; re-enable a filter re-queries; breadcrumb back restores Discover ✅ (`tests/features/disc-doc-02.spec.ts`) |
| IT-F | Context view part: Discover columns (incl. a Map key column) kept ✅ (`tests/features/disc-doc-02.spec.ts` "IT-F: Discover columns are kept") |
| IT-B | Pinned filter arrives disabled on the context page, store unchanged ✅ (`disc-doc-02.spec.ts`) |
| SQL | Surrounding / anchor lookup SQL strings, size clamp, hostile anchors, hostile filter values (jest `src/sql/__tests__/surrounding.test.ts`); URL helpers, hostile `ret`, untrusted `cols` (jest `src/data/__tests__/surrounding.test.ts`) |

## Acceptance

| Criterion | Test / status |
| --- | --- |
| Route `#/context/<dataViewId>/<docId>`, breadcrumb `Discover / Surrounding documents` | e2e "opens from the detail panel ..." (path, breadcrumb) |
| Title `Documents surrounding #<id>` | e2e (heading) |
| Anchor row highlighted | e2e (`data-anchor` row, position 6 of 11) |
| `Load [5] newer documents` above / `Load [5] older documents` below, number editable | e2e "Load [N] newer / older documents, with an editable step" |
| Query dropped; filters carried over but disabled (struck through) | e2e "IT-I: query dropped, filters carried over disabled ..." |
| Columns kept | e2e "IT-F: Discover columns are kept" |
| Two searches asc/desc with search_after from the anchor's sort values, size N | jest `buildSurroundingDocsQuery` older / newer / anchor; e2e tie order at 09:00:30 and 09:01:00 |
| Entry from the document flyout ("View surrounding documents") | e2e (all tests open it from the detail panel); re-anchor e2e |
| Bad / unknown links | e2e "malformed or unknown document links ..."; jest hostile anchors |
| "View single document" permalink (DISC-DOC-01 header) | gap: not built |
