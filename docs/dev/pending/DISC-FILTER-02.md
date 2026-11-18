# DISC-FILTER-02 pending notes

**SQL generation changed**: `buildFilterClause` in `src/sql/queryBuilder.ts` has a new branch for four range operators (`gte`, `lt`, `between`, `not_between`). Needs the coordinator's security review. Bounds are validated first (a plain number, or an ISO-like date on non-Map fields; anything else, including every hostile string, skips the pill: `1=0`, `1=1` for not_between) and then still go through `quoteString`; the column through `quoteIdentifier`. Hostile-value tests are in `src/sql/__tests__/filter_operators.test.ts`.

## CHANGELOG

### Added
- **Filter builder: greater or equal, less than, is between, is not between.** The spec lists these operators; the builder only had is / is not / one of / exists / contains. New `FilterOp`s `gte`, `lt`, `between`, `not_between` (bounds in `values: [low, high]`, inclusive), with labels, negate pairing (gte <-> lt, between <-> not_between) and pill rendering (`NOT` badge for not-between). `samePill` compares a between pair in order. Bounds are validated in the form (numbers for number fields and Map keys, dates for time fields, From <= To, with a message) and again in SQL: an invalid, missing or empty bound skips the pill (matches nothing; not_between matches everything) instead of sending `BETWEEN '1s' AND '5s'` to ClickHouse. A Map value is read as `toFloat64OrNull(toString(col))` (works for `Map(String, String)` and `Map(String, Float64)`; `'9' < '10'`), and there `lt` / `not_between` are `NOT ifNull(positive, 0)` so rows with a missing or non-numeric key fall on exactly one side of an include / exclude pair.
- **Filter builder: live Preview line** showing the pill text before it is added.

### Changed
- **Filter builder: operator list depends on the field type.** Ranges only for number / time / unknown scalars and Map keys (never a whole Map / JSON / Tuple / Array column); substring match not for number / time (ILIKE needs a string). An edited pill keeps its own operator even if the type would not offer it.
- **Filter builder: Value stays disabled ("Please select operator first...") until an operator is picked.** The operator no longer defaults to "is"; Add filter is enabled only when the draft is complete (field, operator, and the values the operator needs). Matches the spec.
- Editing a pill now keeps its `pinned` flag as well as id / disabled.

## Decision

DISC-FILTER-02 (filter builder). Range filters are four new pill ops rather than a generic "range" object, so they plug into the existing pill pipeline unchanged (URL `filters`, saved searches, pin, negate, disable). Bounds live in `values` like one-of, compared inclusively (`BETWEEN`). Bounds are validated (`isNumericBound` / `isDateBound` in `src/sql/filters.ts`) before they reach SQL, where they still go through `quoteString` (column: `quoteIdentifier`); an invalid pill is skipped (1=0, not_between 1=1) rather than failing the query. The SQL compares the literal against the typed column and ClickHouse coerces it (numbers, DateTime). A Map value is compared as `toFloat64OrNull(toString(col))` with numeric bounds only, and its negative ops are `NOT ifNull(.., 0)` so exclude is the exact complement of include (an exclusion of a Map-key range therefore also keeps rows where the key is missing). The operator is no longer pre-selected in the builder (spec: value disabled until an operator is picked), and the operator list is per field type. Not done: OR / AND nested groups and "Edit as Query DSL" (the spec's Elasticsearch JSON editor has no ClickHouse equivalent; nested boolean groups would need a new pill model and are left for a follow-up). Pill range ops are not used by matched-term highlighting (no text to highlight). An unknown `op` in a hand-edited URL is still not validated (pre-existing; `filterOpToSql` has no default).

## TESTING

| Row | Status |
| --- | --- |
| IT-B | Edit now covered for builder-made pills (`tests/features/disc-filter-02.spec.ts`: "IT-B: edit a builder-made pill ...", "IT-B: a builder-made range pill can be negated, disabled and deleted") ✅. Lens part still pending #11. |

## Acceptance

| Criterion | Test / status |
| --- | --- |
| Popover from Add filter; Edit filter reuses it, button "Update filter" | e2e "IT-B: edit a builder-made pill ..."; unit "editing a pill prefills it ..." |
| Field combobox (searchable) with type info | e2e (every builder test picks via the combobox); type shown in option description. No type icons (gap left: text type label only) |
| Operator list depends on field type | unit "DISC-FILTER-02 operator lists"; e2e "operator list depends on the field type" |
| Range validation (numbers / dates / From <= To), invalid pills skipped | unit `validateRange`, SQL `incomplete or invalid ranges are skipped`; e2e "invalid bounds are rejected in the form", "pills with a missing or non-numeric range bound ..." |
| Whole Map column offers no range operators; Map-key ranges are numeric and Exclude is the complement | unit operator lists, SQL `Map negations ...`; e2e "a whole Map column ...", "Map-key range pill from a link ..." (1,200 slow rows; exclude 40,320) |
| Operators: is, is not, is one of, is not one of, greater or equal, less than, is between, is not between, exists | e2e one test per operator (counts: ServiceName payments 9,264; SeverityNumber >= 13 = 9,271; < 9 = 3,984; between 9..13 = 34,345; not between = 7,175; one of auth+payments 17,328); SQL `every operator produces its WHERE` |
| Value input disabled with "Please select operator first..." | unit "blank form ..."; e2e "value input is disabled until an operator is picked ..." |
| Value autocomplete from the shared service | e2e "value autocomplete suggests real values from the shared service" (info / warn / debug / error) |
| Live Preview | e2e (is, is between); unit (edit) |
| Optional custom label | e2e "custom label replaces the pill text" |
| Cancel / Add filter | e2e "Cancel closes the builder ..."; Add stays disabled until complete (e2e + unit `isFilterComplete`) |
| Hostile values | SQL tests (quotes, backslashes, `') OR 1=1 --`) for all value ops; e2e "hostile value is data, not SQL" |
| IT-B: builder-made pills re-query on edit / negate / disable / delete | the two IT-B e2e tests |
| Rows with OR / AND nested groups (`+ OR`, `+ AND`) | gap left: needs a nested pill model; separate feature |
| Edit as Query DSL (JSON editor) | gap left: Elasticsearch concept, no ClickHouse equivalent |
| ~1200 px wide popover | gap left: kept at 760 px (all three inputs fit; no change in behaviour) |

## Security note (URL pills)

`decodeLogsState` (`src/data/urlState.ts`) now passes URL `filters` through `sanitizeFilterPills` (`src/sql/filters.ts`): a pill is dropped unless `op` is a known FilterOp and `field` / `value` / `values` (and `label`) are strings (a missing `value` becomes `''`, a missing `id` is generated). Tests: `src/data/__tests__/urlState.test.ts`.
