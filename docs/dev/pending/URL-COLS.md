# URL-COLS pending notes (security fix, patch bump, no PLAN row)

## CHANGELOG

### Security
- **SQL injection through shared links and saved searches** (pre-existing). A Discover URL's `cols` (and a saved search's columns) carried each column's `sqlExpr` and `key`, which `buildLogsQuery` emitted verbatim as `${sqlExpr} AS ${key}`; the URL `sort` column and direction reached `ORDER BY` the same way. A crafted link could run arbitrary SELECTs (e.g. `system.users`) as the datasource user. Restored columns are now rebuilt from trusted sources (`sanitizeColumns`, `src/data/columns.ts`): core columns from the view mapping, discovered fields by id, pinned columns by id, otherwise only a plain column reference (identifier, well-formed Map accessor, dotted path) with a regenerated alias and a checked type. The query builder additionally never emits a non-identifier alias or a non-column-reference expression (`extraColumnSelects`), accepts only an identifier as the sort column (else the default sort) and only `asc`/`desc`. The surrounding-documents page uses the same sanitizer (strict mode).

## Decision

SEC-URL-COLS. Anything restored from a URL or storage is data, not SQL. One sanitizer, `sanitizeColumns(raw, config, fields?)`, rebuilds columns: `isCore` → the view's own core column by id (URL expr/key ignored); a discovered field id → `fieldToColumn`; a pinned column id → the config entry; otherwise the expression must pass `isSafeColumnExpr` (bare identifier, `looksLikeMapAccessor`, or `DOTTED_PATH_RE` — grammars that can only name a column), the alias is regenerated with `makeColumnKey(id)`, the type must be a known `ColumnType` (else `unknown`), and the display name is kept as text only. Strict mode (fields given, used by the surrounding page) also requires the expression to be a discovered field's or a key of a discovered Map column. Discover's initial state uses lenient mode because fields are not discovered yet at that point; the builder-side checks are defence in depth. Trade-off: a discovered column whose name is not a plain identifier (e.g. `my-col`) can no longer be added as an extra column via its raw name (it previously produced broken SQL anyway). `contextColumns` (DISC-DOC-02) now delegates to the shared sanitizer.

## TESTING

| Case | Status |
| --- | --- |
| Hostile `cols` (expr/alias with `FROM system.users --`, subqueries, hostile core expr) dropped or rebuilt from the mapping; types checked; duplicates dropped; strict mode keeps only discovered fields / Map keys (jest `sanitizeColumns.test.ts`) | ✅ |
| `buildLogsQuery` never emits an unsafe alias / expression; hostile sort column and direction fall back (jest `sanitizeColumns.test.ts`) | ✅ |
| Crafted link renders without the injected column; hostile core column uses the mapping; hostile sort falls back; a legitimate Map key column from a link is kept (`tests/features/sec-url-cols.spec.ts`) | ✅ |
