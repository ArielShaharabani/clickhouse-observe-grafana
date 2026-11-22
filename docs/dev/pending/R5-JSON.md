# R5-JSON pending notes

**This change touches SQL generation** (`src/sql/introspection.ts`, `src/sql/jsonPaths.ts`, `src/sql/kql/toSql.ts`, `src/sql/queryBuilder.ts`). New query: `buildJsonPathTypesSampleQuery` (`SELECT toJSONString(distinctJSONPathsAndTypes(<col>)) AS types FROM (SELECT <col> FROM "<db>"."<table>" LIMIT 1000)`), run alongside the existing bare `distinctJSONPaths` query (one extra request per JSON column at page load, bounded). Dynamic JSON paths seen with one plain type get the field expression `<col>.<path>.:<Type>` (typed Dynamic subcolumn). The type comes from ClickHouse's answer, so it is untrusted-ish data: only `U?Int8..256`, `Float32/64`, `Bool`, `String` and `Array(...)` of these (letters, digits and parentheses only) are accepted (`isTypedSubcolumnType`); anything else keeps the bare path. `DOTTED_PATH_RE` (`isSafeColumnExpr` / `looksLikeTrustedExpr`) accepts that optional `.:Type` / `` .:`Type(...)` `` suffix and nothing after it (tests with injection attempts). KQL / filter pills on JSON paths: ranges `toFloat64OrNull(toString(x))`, wildcard / contains `toString(x) ILIKE …`, arrays `arrayExists(x -> toString(x) = '…', col)`, exists `notEmpty(ifNull(toString(x), ''))`, not-exists pill `empty(ifNull(toString(x), ''))`, a value on a whole JSON column `0`, exists on it `notEmpty(JSONAllPaths(col))`. All values still go through `quoteString`, identifiers through `quoteIdentifier`. Map ranges unchanged. The coordinator should run the security review.

## CHANGELOG

### Added
- **Map / JSON field labels (round 5 #7).** Map and JSON columns and their keys / paths show a `Map` or `JSON` badge in the Discover sidebar and the Visualize field list; hovering a field's icon, name or badge shows where it comes from and its ClickHouse type.
- **Typed JSON paths.** Dynamic (undeclared) JSON paths get their type from a small sample, so a numeric path is a number field: Visualize can average / sum / take percentiles of it, the field popover shows its distribution, and top values no longer count rows without the path as an empty value.

### Changed
- **KQL autocomplete drills into a JSON column** like a Map: accepting `Payload` inserts `Payload.` and lists its paths; values of a path are suggested from its typed column.

### Fixed
- Visualize top values and metrics on a dynamic JSON path failed (`Data types Variant/Dynamic are not allowed in GROUP BY keys`, `Illegal type Dynamic of argument for aggregate function avg`).
- `Payload.x < 100` matched every row without the path (a missing value read as 0); `Payload.name > 1` failed ("Cannot parse string as Float64").
- `Payload.user.id : 1*` failed (ILIKE on a number); `Payload.tags : retry` on an array path failed; `Payload : x` failed parsing `x` as JSON (now matches nothing); `not Payload.x:*` matched nothing.
- Filter pills on JSON paths: ranges compare numerically, "does not exist" counts rows without the path, "contains" works on numeric paths, array paths match any element.
- The document panel no longer shows only an error when the JSON-path lookup of one column failed; the path list falls back to the sample when the whole-table lookup fails (e.g. times out).

## Decision

Kibana-like behaviour where a product choice was needed: an array path matches when any element matches (Elasticsearch multi-value semantics); a value query on a whole object (JSON column) matches nothing, `Payload:*` is "has any path"; a field's type tooltip is shown on hover of its label (the sidebar row keeps its `title` = SQL expression, which existing specs and the row semantics rely on). Dynamic-path types: sampled from the first 1,000 rows read (no ORDER BY, so a few granules) rather than the newest rows, which would read the JSON column of the whole range on servers without lazy materialization; a path with several types, a date / decimal / other type, or not seen in the sample stays a bare `Dynamic` string field (stringified everywhere), so no query can hit the Dynamic restrictions. JSON array paths are type `array` and so, like other containers, not offered in Visualize. The typed expression replaces the bare one in `FieldModel.sqlExpr`; a filter / KQL / URL column using the bare dotted name still resolves to it through the display-name lookup. Root causes: (1) dynamic paths were published as bare `Dynamic` expressions typed 'string', which ClickHouse refuses in GROUP BY / numeric aggregates and casts NULL→0 in `toFloat64`; (2) the KQL bar offered the JSON column itself as a terminal field (`Payload : value` compares a whole object), not a drill-down; (3) the document panel treated any discovery error, including one JSON column's path-lookup failure, as fatal.

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/sql/__tests__/r5_json.test.ts` (typed path fields, type allowlist, safe-expression regex incl. injection, sample query, KQL ranges / wildcard / arrays / container / NULL-safe exists, filter pills, autocomplete drill-down and typed value context, badges / tooltips, `mapValueType`), `FieldsContext.test.tsx` (typed subcolumn from the sample, fallback to sampled paths without error), `LogDetailDrawer.test.tsx` (partial discovery failure renders the document), `FieldStatsTab.test.tsx` (missing JSON path is absent), `perfMetadata.test.tsx` (counts: + one type-sample query) |
| SQL | Every generated statement (KQL, pills, top values, numeric stats, field-stats batch, Lens terms / terms+Other+missing / avg / max / median / sum / unique / last value, grid with a JSON column) run against `default.otel_logs` (dynamic paths) on ClickHouse 26.3: no errors except deliberately wrong inputs (numeric aggregate forced on a text path, `100` compared with a Bool) |
| E2E | `tests/features/r5-json.spec.ts` — not run (coordinator) |

## Deferred

- Saved Visualize charts / URLs that reference a dynamic path by its old bare expression (`Payload.x`) are dropped by Visualize's field check now that the field reads `Payload.x.:Int64` (Discover filters and KQL still resolve the bare name). A remap in `sanitizeLens` would keep them.
- The `spec_logs` fixture only has the declared `Payload.user.id` (always 0), so e2e covers declared paths only; dynamic-path behaviour is covered by jest and by running the SQL against `otel_logs`. Seeding a few dynamic paths into `04_spec_fixture.sql` would let e2e cover them (fixture change needs a reseed).
- Histogram breakdown by a typed JSON path counts rows without the path under "Other".
- A JSON path with several observed types (e.g. Int64 + String) stays a text field.
