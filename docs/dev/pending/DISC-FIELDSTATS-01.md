# DISC-FIELDSTATS-01 pending notes (#22 Field statistics tab)

## CHANGELOG

### Added
- **Field statistics tab on Discover** (#22, DISC-FIELDSTATS-01; spec 10-discover.md). A `Documents | Field statistics` switch in the results toolbar. The tab lists every field of the data view, sorted by name: type icon · name · `Documents (%)` (sampled documents with a value) · `Distinct values` · `Distributions` (keyword: bar strip of the top values + `N categories` / `top 10 of N categories`; number: 10-bucket density sparkline with min and max labels; an eye switch hides the column) · Visualize action (same Lens hand-off as the field popover). Rows expand to Documents stats (count, %, distinct), Summary (min / median / max for numbers), Top values (count and %, Filter for / Filter out) and, for numbers, a distribution chart. Name filter; 25 fields per page.
- Stats follow the page's query, filters and time (same 5,000 most-recent-rows sample as the field popover), so the tab and the popover agree.
- New diagnostics op `fieldStats` ("Field statistics").

## Decision

DISC-FIELDSTATS-01 (#22). One query per page of 25 fields (`buildFieldStatsBatchQuery`, `src/sql/fieldStats.ts`): the sample (most recent `STATS_SAMPLE_SIZE` = 5,000 matching rows, as in the popover) is read once; per field `sumMap` builds value → count (empty, `'{}'`, `'[]'`, `'null'` excluded like `buildFieldTopValuesQuery`), from which documents, distinct values and the top 10 come; numbers also collect `groupArray` of `toFloat64OrNull` values for min / median (`quantileExact`) / max and the same 10 equal-width buckets as `buildNumericStatsQuery`. Aliases are positional (`v0`, `m0`, `tv0`, …): field names never become SQL identifiers; `sqlExpr` comes from field discovery only (never the URL). Map / JSON / Tuple containers are not profiled (their keys / paths are); JSON paths are. Distinct values and percentages are over the sample, not the whole range (same as the popover). The tab is local page state, not in the URL; switching to it closes the detail drawer. Geo → Maps action not built (no geo type).

## TESTING

| Case | Status |
| --- | --- |
| IT-A | Stats tab as producer (expanded row Filter for → count + stats refresh) and consumer (URL filter → 1 category, 27.4% payments errors) (`tests/features/disc-fieldstats-01.spec.ts`) ✅ |
| IT-G | Stats tab Visualize → Visualize page with the same query (`disc-fieldstats-01.spec.ts`) ✅ |
| Table | documents %, distinct, keyword strip / numeric sparkline, eye toggle, name filter, back to Documents (`disc-fieldstats-01.spec.ts`; jest `FieldStatsTab.test.tsx`) ✅ |
| SQL | one sample per batch, positional aliases, numeric-only summary, absent stand-ins dropped (jest `field_stats.test.ts`); checked against ClickHouse on the fixture (3,483 / 792 / 487 / 238) ✅ |

## Deferred
- Tab in the URL (reload restores Documents); Patterns tab (#21 skipped).
- Geo → Maps action; Lens icon per type beyond Visualize.
- Field-type filter in the tab (the sidebar has one).
