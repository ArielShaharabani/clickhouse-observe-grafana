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

LENS-DIM-04: top values options live on `TermsDim` as optional fields (`rankBy` count|alpha|metric, `rankMetric` metric id, `rankDir`, `other`, `missing`, `include`, `exclude`, `regex`); defaults are omitted so existing URLs and default SQL are byte-identical. The ranked CTE applies the eligibility predicate (non-null, or null when `missing`, plus include/exclude) and the rank order; without Other the outer query restricts to the CTE with `GLOBAL IN`, with Other it keeps all eligible rows and selects `if(expr GLOBAL IN (cte), expr, 'Other')`. Every user string goes through `quoteString`, plus `$` is written as `\x24` so the ClickHouse datasource macro expander in saved panels never sees `$__...` text from a value. Synthetic values ("Other", "(missing)") are not clickable: a click on them adds no filter (Other stands for many values; a negated list of the top values was judged surprising and can be long). A real value literally named "Other" or "(missing)" is also not clickable while that option is on. Not implemented: multi-field terms, "Aggregate by this dimension first", Rarity and Significance ranking (ascending count covers rarity), accuracy mode (ClickHouse aggregates are exact, no shard_size).

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
| Click-to-filter on Other / (missing) | jest `click-to-filter ignores the synthetic values`; no e2e |
| Hostile values | jest `hostile values stay inside a string literal`, `macro text ... hex-escaped`; e2e hostile include |
