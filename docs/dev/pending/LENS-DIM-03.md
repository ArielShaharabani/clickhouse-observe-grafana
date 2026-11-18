# LENS-DIM-03 pending notes (#23 Formula editor)

## CHANGELOG

### Added
- **Formula metrics on Visualize** (#23, LENS-DIM-03; spec 20-lens.md "Formula editor"). A metric's editor has a `Quick function | Formula` switch; switching converts the quick function (`median(SeverityNumber)`, `percentile(x, percentile=95)`, `count()`). Formulas combine aggregations with `+ - * /`, parentheses and numbers, e.g. the error rate `count(kql='SeverityText : error') / count()`.
- Functions: `count([field], kql=)`, `average`, `sum`, `min`, `max`, `median`, `percentile(field, percentile=95)`, `unique_count` (all with an optional `kql='…'` filter), and math `abs`, `round(x, decimals)`, `floor`, `ceil`, `sqrt`, `exp`, `log(x, base)`, `pow`, `mod`, `clamp`, `pick_max`, `pick_min`, `defaults`. Field names that are not plain identifiers are written in backticks.
- Editor: autocomplete for functions (full signature + description) and fields, auto-closed brackets and quotes, an error list with a `⚠ N errors` badge, function reference (📖), word-wrap and expand toggles. Applied on blur or Ctrl+Enter, only when valid. Division by zero gives an empty value, not ∞.

### Security
- Formulas never reach SQL as text: they are parsed into an AST with a whitelist of functions, operators and named arguments; field references resolve through the metric's field map whose SQL expressions `sanitizeLens` checks against the discovered fields (same rule as a quick function's field), and are emitted with `quoteIdentifier`; numbers are lexer-restricted; `kql=` filters go through the existing KQL compiler (and in saved dashboard panels `$` in them is written as `\x24`, so no macro / variable expansion). Length (1,000 chars), node (200) and depth (32) limits.

## Decision

LENS-DIM-03. A formula is a metric with `op: 'formula'`, `formula` (text) and `formulaFields` (name as written → `{ expr, numeric }`, only the fields it uses). The URL carries both; `decodeLens` keeps only well-formed entries and `sanitizeLens` drops a formula that does not parse / validate or names a field expression outside the discovered fields. `compileLens` re-parses and compiles the AST (`src/lens/formula.ts`); anything invalid compiles to `NULL`, never to its text. KQL filters per aggregation use ClickHouse `-If` combinators (`countIf`, `avgIf`, `quantileIf(q)(x, cond)`), compiled with the page's field index (new optional `index` argument of `compileLens`; saved panels compile without it, like their search conditions). Deferred: Monaco editor with positioned red squiggles (a plain monospace text box lists errors with their character position instead), `shift=` (time shift; reported as "not supported yet"), `reducedTimeRange`, `lucene=`, `last_value`, `counter_rate` / time-series functions (`cumulative_sum`, `differences`, `moving_average`), formula value formatting.

## TESTING

| Case | Status |
| --- | --- |
| Formula parse / compile / precedence / functions | jest `src/lens/__tests__/formula.test.ts` ✅ |
| Injection attempts (SQL in formula, field names, KQL quotes, unknown functions, nesting/length limits, `$` in dashboard mode) | jest `formula.test.ts` ✅ |
| URL codec + sanitizeLens for formulas (unknown keys dropped, foreign field expr dropped, invalid formula dropped) | jest `formula.test.ts` ✅ |
| Editor: convert quick → formula, apply on blur, error badge, autocomplete + bracket auto-close, function reference, back to quick | jest `src/lens/__tests__/FormulaEditor.test.tsx` ✅ |
| E2E: URL formula runs (errors per service 1,575 / 445); convert + edit + reload; autocomplete + error badge; foreign-field formula from a shared link dropped and no SQL from it sent | `tests/features/lens-dim-03.spec.ts` — not run yet (coordinator) |
