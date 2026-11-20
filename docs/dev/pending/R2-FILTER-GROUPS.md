# R2-FILTER-GROUPS (Finding 7, DISC-FILTER-02 follow-up)

## CHANGELOG

- Filter builder: one pill can now hold several conditions combined with OR and AND, with nesting (AND of ORs, OR of ANDs, up to three levels like Kibana). Each condition row has "Add OR condition" / "Add AND condition" and a delete button; the Preview line shows the combined filter (for example `ServiceName = payments OR (ServiceName = auth AND SeverityNumber = 17)`).
- Compound pills negate, disable, pin, edit and delete as a whole, appear in the URL and saved searches, and read as one pill (`NOT (...)` when excluded). Single-condition pills and existing links are unchanged.

## DECISIONS

R2-FILTER-GROUPS (Finding 7). The builder's compound filter is stored on the pill itself, not as a new pill type: `FilterPill.cond` is a tree `{ join: 'or' | 'and', items: [leaf | group] }` whose leaves have the same `field/op/value/values` shape as a plain pill, and `negate` flips the whole pill (`NOT (...)`). The pill keeps `field: ''`, `op: '='` as placeholders so every consumer that only reads those still works; a tree with a single condition is saved as a plain pill (the builder collapses it), so old URLs, saved searches and pinned pills stay valid and no migration exists. SQL: `buildFilterClause` dispatches on `cond` and compiles each leaf through the existing per-condition compile (quoting and range validation unchanged), then wraps every item and group in parentheses (`((a) OR ((b) AND (c)))`, `NOT (...)` for negate), so precedence cannot leak and a compound pill can still sit inside a D48 pill-level OR group. Untrusted input: `sanitizeFilterPills` rebuilds the tree field by field (`sanitizeCondGroup`): known join, 1 to 20 items per group, at most 3 levels and 40 leaves, leaves validated like pills (known op, string field/value/values, unknown keys stripped); any malformed tree drops the whole pill, because dropping a single leaf would silently widen an AND or narrow an OR. `negate` is kept only with `cond`. Builder: rows are a draft tree (`TreeGroup`, generic helpers `addCondition` / `removeCondition` / `canAddCondition` in `sql/filters.ts`): "OR"/"AND" next to a row appends to its group when the join matches (or the group has only that row), otherwise the row becomes a nested group, disabled at the depth cap. `samePill` compares trees so two different compound pills do not dedupe. Not done: "Edit as Query DSL" and an "Edit as SQL" escape hatch (no DSL in ClickHouse; free SQL would bypass the escaping), and drag and drop of conditions.

## TESTING

| Acceptance / behaviour | Test |
|---|---|
| Compound pill compiles to parenthesised OR / AND (nested), NOT for negate, disabled adds nothing, works inside a pill-level OR group | unit `src/sql/__tests__/filter_cond_groups.test.ts` "compound pill SQL" |
| Injection in values and field names inside groups is escaped | unit "escapes injection attempts...", "quotes hostile field names..."; e2e "hostile values inside a group are data, not SQL" |
| URL round trip, old single-condition URLs unchanged, malformed / over-deep / oversized trees dropped, unknown keys stripped | unit "compound pill sanitize and URL"; e2e "hand-written link ..." (2 tests) |
| Pill label and Preview text (OR / AND, nested parentheses, NOT, custom label wins) | unit "compound pill labels and identity"; e2e "OR of two conditions...", "OR of ANDs..." |
| Add / remove / nest conditions, depth cap | unit "condition tree operations" |
| Compound pill counts rows correctly (OR 17,328; OR of AND 9,648) | e2e `tests/features/r2-filter-groups.spec.ts` |
| Negate, disable, delete on the whole pill; survives reload; edit and collapse to a plain pill | e2e same spec |
