# DISC-FILTER-02 pending notes

**SQL generation changed**: `buildFilterClause` in `src/sql/queryBuilder.ts` has a new branch for four range operators (`gte`, `lt`, `between`, `not_between`). Needs the coordinator's security review. Every bound goes through `quoteString`, the column through `quoteIdentifier`; hostile-value tests are in `src/sql/__tests__/filter_operators.test.ts`.

## CHANGELOG

### Added
- **Filter builder: greater or equal, less than, is between, is not between.** The spec lists these operators; the builder only had is / is not / one of / exists / contains. New `FilterOp`s `gte`, `lt`, `between`, `not_between` (bounds in `values: [low, high]`, inclusive), with labels, negate pairing (gte <-> lt, between <-> not_between) and pill rendering (`NOT` badge for not-between). Map values (Strings) compare numerically via `toFloat64OrNull` so `'9' < '10'` is not a lexical surprise; an incomplete range is `1=0` (between) / `1=1` (not between).
- **Filter builder: live Preview line** showing the pill text before it is added.

### Changed
- **Filter builder: operator list depends on the field type.** Ranges only for number / time / Map / unknown fields; substring match not for number / time (ILIKE needs a string). An edited pill keeps its own operator even if the type would not offer it.
- **Filter builder: Value stays disabled ("Please select operator first...") until an operator is picked.** The operator no longer defaults to "is"; Add filter is enabled only when the draft is complete (field, operator, and the values the operator needs). Matches the spec.
- Editing a pill now keeps its `pinned` flag as well as id / disabled.

## Decision

DISC-FILTER-02 (filter builder). Range filters are four new pill ops rather than a generic "range" object, so they plug into the existing pill pipeline unchanged (URL `filters`, saved searches, pin, negate, disable). Bounds live in `values` like one-of, compared inclusively (`BETWEEN`). Bounds and column reach SQL only through `quoteString` / `quoteIdentifier`; the SQL compares the literal string against the typed column and ClickHouse coerces it (numbers, DateTime). The exception is a Map value (always String): both sides are wrapped in `toFloat64OrNull`, so ranges on `LogAttributes['duration_ms']` are numeric and a non-numeric bound matches nothing. The operator is no longer pre-selected in the builder (spec: value disabled until an operator is picked), and the operator list is per field type. Not done: OR / AND nested groups and "Edit as Query DSL" (the spec's Elasticsearch JSON editor has no ClickHouse equivalent; nested boolean groups would need a new pill model and are left for a follow-up). Pill range ops are not used by matched-term highlighting (no text to highlight). An unknown `op` in a hand-edited URL is still not validated (pre-existing; `filterOpToSql` has no default).

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
