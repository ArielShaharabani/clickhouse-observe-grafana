# LENS-DIM-04 pending notes

**This feature changes SQL generation** (`src/lens/compile.ts`, top-values buckets). The coordinator should run the security review: new user-controlled strings (include / exclude values, regex patterns) reach SQL as literals.

## CHANGELOG

### Added
- **Top values: Rank by and Rank direction.** Rank by Count of records (default), Alphabetical, or a Custom metric (any metric of the chart); ascending or descending. Needed to answer "least common" and "first alphabetically" questions.
- **Top values: "Group remaining values as Other".** Values outside the top N collapse into one `Other` value so totals stay complete.
- **Top values: "Include documents without this field".** Rows without the field appear as `(missing)` instead of being dropped.
- **Top values: Include values / Exclude values with "Use regular expression".** One value or pattern per line; regex patterns are full-match (`match(expr, '^(?:p)$')`).

### Changed
- **Lens URL/state validation covers the new options.** `decodeLens` rebuilds each top-values bucket from known, well-typed fields only (`cleanTerms`); lists are capped at 50 entries of 200 characters; `sanitizeLens` resets a rank metric that no longer exists.

## Decision

LENS-DIM-04: top values options live on `TermsDim` as optional fields (`rankBy` count|alpha|metric, `rankMetric` metric id, `rankDir`, `other`, `missing`, `include`, `exclude`, `regex`); defaults are omitted so existing URLs and default SQL are byte-identical. A bucket without Other / missing compiles exactly as before. With Other and/or missing on, the value is computed once as `_rN`, a row-kind column `kN` (0 value, 1 Other, 2 missing) is returned beside it and the value column is empty for synthetic rows, so a real value spelled "Other" or "(missing)" can never merge with the synthetic bucket (the shaper keys synthetic buckets with a U+0000 prefix and shows a colliding real value as "Other (value)"; its click filter still uses the real value). "(missing)" is an extra bucket outside the top N and NULL never takes a ranking slot. Other keeps every eligible row. For Map accessors the missing test is `mapContains(map, key)` (an absent key reads as '' otherwise); for a non-Nullable column there is no "missing", an empty string stays a value. The outer ORDER BY follows the rank (alphabetical by value, custom metric by its column, count by `count()` or `m0`) in the chosen direction, with Other and (missing) always last. Every user string goes through `quoteString`, and `$` is written as `\x24` so the datasource macro expander in saved panels never sees `$__...` text. Regular expressions are validated (`regexError`): unbalanced parentheses or brackets, a trailing backslash (both could break out of the `^(?:p)$` wrapper), lookaround, back-references and invalid syntax are rejected in the editor with a message under the field and the text is kept; the compiler also skips such patterns (URL input is untrusted) and an include list with no usable pattern matches nothing. Lists over 50 values or 200 characters per value are reported, not silently cut (URL input is still capped). Synthetic rows are not clickable (no filter), and "Custom metric" is disabled without a metric; removing the rank metric resets the stored rank to count. Labels follow the rank: "Top/Bottom N values of X" (count), "First/Last N values of X" (alphabetical), "... by <metric>" (custom). Not implemented: multi-field terms, "Aggregate by this dimension first", Rarity and Significance ranking (ascending count covers rarity), accuracy mode (ClickHouse aggregates are exact, no shard_size).

## TESTING

| Area | Row |
| --- | --- |
| Top values rank | Alphabetical asc top 1 = auth, desc = payments; fixture `spec-fixture` (e2e) |
| Top values Other | Top 3 + Other: payments 9,264, Other 16,128 (e2e) |
| Top values include/exclude | exclude payments; regex include `pay.*` / `front.*`; hostile include value returns nothing (e2e) |
| SQL escaping | hostile quotes/backslashes/`$__` in values stay in literals (jest `topValues.test.tsx`) |
| URL validation | invalid rankBy/rankDir/lists dropped, extra props removed (jest) |

## Acceptance

| Criterion | Status |
| --- | --- |
| Rank by Count / Alphabetical / Custom metric | jest `ascending count, alphabetical ... custom metric ranking`; e2e `rank alphabetically` |
| Rank by Rarity, Significance | gap left: Rarity is count ascending; Significance needs a background set, not meaningful here |
| Rank direction | jest + e2e `rank alphabetically` |
| Group remaining values as Other | jest `Other: ...`; e2e `Top 3 + Other` |
| Include documents without the field | jest `missing values become "(missing)"`; no e2e (fixture has no null ServiceName) |
| Include / Exclude values, regex | jest `include / exclude ...`; e2e `exclude values, and include by regular expression` |
| Multi-field terms, Aggregate by this dimension first, accuracy mode | gap left: out of scope for this step (see Decision) |
| Saved panels / dashboard mode | jest `dashboard mode and saved panels carry the options` |
| Click-to-filter on Other / (missing) | jest `shaping: synthetic ...` (flags drive the click guard); no e2e |
| Order follows rank, Other last | jest `outer order follows the rank`; e2e `alphabetical rank lists values in alphabetical order` |
| Missing on Map keys, real "Other" kept apart | jest `missing on a Map key ...`, `shaping: synthetic ...` |
| Regex / list validation | jest `regexError`, `listError`, editor UI test; e2e `invalid regular expression` |
| Hostile values | jest `hostile values stay inside a string literal`, `macro text ... hex-escaped`; e2e hostile include |
