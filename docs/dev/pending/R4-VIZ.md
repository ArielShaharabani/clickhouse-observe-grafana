# R4-VIZ pending notes

**This change touches SQL generation** (`src/lens/formula.ts`, `src/lens/compile.ts`): new `percentileRankSql(x, value, cond?)` → `avgOrNull(toFloat64(<x> <= <value>))` / `avgIfOrNull(…, <cond>)`, used by the quick function (`compile.ts` `metricSql`) and the formula's `percentile_rank(field, value=N)` (`emitAgg`), in app and saved-panel mode alike. Untrusted input: the URL / saved `rankValue` (metric and calculation inner metric) goes through `cleanRankValue` (a finite number within ±1e15, anything else → 0) in `cleanMetrics` / `cleanRef`, and again right before printing; the formula's `value=` is a lexer number token (digits only; a leading `-` is now accepted for named arguments and re-attached as text), validated finite and within ±1e15, then printed through `cleanRankValue`. Fields are discovered fields checked by `sanitizeLens` and quoted with `quoteIdentifier`, as for every quick function. No user text is concatenated into SQL. The coordinator should run the security review. Field discovery (`src/components/FieldsContext.tsx`) still issues the same SQL; only the order changes (the skip-index lookup runs alongside `system.columns`), and Visualize no longer issues it.

## CHANGELOG

### Added
- **Visualize: Percentile rank** (round 3 #22). Quick function with a `Percentile ranks value` input (any number, decimals allowed, default 0 as in Kibana): the share of a number field's values that are less than or equal to the value, shown as a percent ("77.67%") unless the metric has its own Value format. Label "Percentile rank (9) of SeverityNumber". Also as the inner metric of Differences / Moving average, and in Formula as `percentile_rank(field, value=N)` (0–1). Saved dashboard panels compute the same SQL and show it as a percent.

### Changed
- **Visualize pie / donut labels** (round 3 #18): drawn by the page instead of Grafana's piechart. Labels read like Kibana's ("info 43.93%", up to two decimals), sit inside the slice (the donut's ring) when they fit, otherwise outside with a leader line, and never overlap; the legend shows value and decimal percent; hovering a slice shows a tooltip; one click (or Enter) on a slice filters on its value. Saved dashboard pie panels are unchanged (Grafana's piechart).
- **A fresh Visualize open starts with an empty workspace** (round 3 #19), as Kibana's Lens: the side-menu link no longer brings back the previous chart (the per-tab session draft is gone). A reload, Back, a shared link and Explore in Discover → Back keep the chart, which rides in the URL.
- **Visualize opens faster** (round 3 #8): the chart query starts as soon as the table's columns are known (it no longer waits for the JSON-path lookup unless the chart uses a JSON path), and Visualize skips the text skip-index lookup it never used — one query and two round trips fewer before the chart on a table with a JSON column (perf-50m: 7 → 6 queries). Discover reads the skip indexes alongside the columns instead of after them (one round trip fewer before its first query).

### Fixed
- Search suggestions no longer reopen after Enter (or Clear) when a value lookup was still pending (round 3 #20; the shared search bar, so Discover too).
- Metric tiles by category fit the chart area: rows shrink from 140 px down to 110 px before the grid scrolls (the third row was cut by 8 px; round 3 #23).

## Decision

R4-VIZ (round 3 Visualize rows 8, 18, 19, 20, 22, 23).

Percentile rank follows Kibana 9.5's `percentile_rank` operation (read from its Lens bundle): `operationParams: value` (number, default 0), number fields only, filterable / shiftable, allowed as a reference (inner metric) — so it is in `BASE_OPS`, except Cumulative sum (Count / Sum only, unchanged). Kibana's `aggSinglePercentileRank` returns the ES percentage / 100 with the serialized format `percent`; we return the same 0–1 share and default the display to percent with two decimals through `formatOf(metric)` (the metric's own format wins; a calculation over a percentile rank also defaults to percent), applied in every renderer and in saved panels (`percentunit`). The formula result keeps the number format (Kibana's formula column has no per-function default). The SQL is the exact share (`avgOrNull(toFloat64(x <= v))`, NULLs skipped, no values → empty), not ES's TDigest estimate: on the fixture `percentile_rank(SeverityNumber, value=9)` is 77.67 % here and 66.25 % in Elasticsearch, whose TDigest interpolates across the many equal values (9.60 % are < 9, 77.67 % are ≤ 9); Kibana's own docs define it as "the percentage of values which are below a certain value" with "greater than or equal to 95 % of the observed values" — the exact ≤ share. `rankValue` lives in `calc.ts` with the other calculation constants (state.ts re-exports it) to keep formula.ts free of a state.ts import cycle.

Pie / Donut: Grafana's piechart has one panel-wide label switch, whole-number percents and no collision handling, so the slices are drawn by `render/PieChart.tsx` like the XY charts and the heat map. Placement: try the label inside the slice (exact box-in-sector test, a few radii for a pie, the ring's middle for a donut; one line, then name / percent on two lines), else outside left / right of the mid-angle with an elbow leader line; outside labels are spread per side top to bottom (forward then backward pass) and, when the height cannot hold them all, the smallest slices lose their label (legend and tooltip keep the numbers). The pie shrinks to leave room for outside labels. The old Grafana-panel path (`pieSpec`, `pieDisplayLabels`) stays for multi-series pies and is what `panelSpec` still describes. Click on a slice uses the existing filter chooser (`onSelect`, x index = slice).

Fresh open: the brief asks for an empty workspace on a fresh open while a reload keeps the chart. A reload keeps the URL (`lens`), so the session draft's only remaining effect was the behaviour being removed; it is deleted (`src/lens/draft.ts`, `visualizeEntry`'s step 4, the save effect) rather than kept as dead storage. A stale `clickhouse-observe.lensDraft` entry in a tab's session storage is simply never read.

Open performance: on perf-50m the 7 queries were `system.columns`, `system.data_skipping_indices`, `distinctJSONPaths(Payload)`, three map-key samples and the chart; the chart waited for columns → skip indexes → JSON paths (three serial round trips; each query is 8–80 ms in ClickHouse, the rest is the Grafana round trip). Now the chart waits for the columns only (`lensFieldsPending`: columns published and, while discovery is still running, every field of the chart already known — `sanitizeLens` would not drop anything), Visualize does not request skip indexes (its search compile never used them: `buildFieldIndex(fields)` without text indexes), and other pages fetch them concurrently with the columns (shared in-flight promise per table). Map-key samples still run (the field list needs them), after the columns and in parallel with the chart. Not measured here (no browser runs): expected about two round trips less before the chart; the remaining ~3 s is Grafana's own boot.

Search suggestions: `commit()` / `onClear()` already closed the list, but the 250 ms debounced value fetch (and a Map-key fetch) of the last keystroke was still allowed to reopen it. Both now bump the request sequence and clear the debounce (`cancelPendingSuggestions`).

Metric tiles: `grid-auto-rows: minmax(110px, 140px)` with the grid's definite height lets the rows grow to 140 px only within the free space, so three rows fit a 428 px area; more rows than fit at 110 px scroll as before.

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/lens/__tests__/percentileRank.test.tsx` (labels, SQL app / dashboard / Filter by / inner metric, URL cleaning, percent default + saved panel `percentunit`, function switching, formula accept / reject / SQL / quick → formula, editor value input incl. decimals and the inner-metric input) |
| Jest | `src/lens/__tests__/pieChart.test.tsx` (decimal percent, severity pie labels and no overlap, outside labels + leader lines, donut labels in the ring or outside, many thin slices, full circle, slices as buttons that filter, legend, tooltip) |
| Jest | `src/components/__tests__/SearchBar.test.tsx` (Enter closes the list; the pending value fetch does not reopen it — fails without the fix) |
| Jest | `src/components/__tests__/perfMetadata.test.tsx` (skip-index lookup in flight before the columns answer; skipped with `textIndexes: false`) |
| Jest | `src/lens/__tests__/dataview.test.ts` (open without `lens` stays empty even with a stored draft; URL lens kept; `lensFieldsPending`) |
| Jest | `src/lens/__tests__/save.test.ts` (draft tests removed with the draft) |
| E2E | `tests/features/r4-viz.spec.ts` — not run (coordinator) |
| E2E | `tests/features/lens-save-01.spec.ts` (fresh open empty, reload keeps the chart; replaces the session-draft test) — not run (coordinator) |
| E2E | `tests/features/parity-charts2.spec.ts`, `tests/features/r3-charts.spec.ts` (pie / donut are `data-panel="pie"` now) — not run (coordinator) |
| Manual | perf-50m Visualize load (`kibana-compare/round3/visualize/o-perf.js`): expect 6 queries, no `data_skipping_indices`, chart query issued right after `system.columns` — not run (coordinator) |

## Deferred

- Saved dashboard pie / donut panels still use Grafana's piechart (whole-number labels, no collision handling); only Visualize draws its own.
- Kibana rotates a thin slice's label along the slice; here it goes outside with a leader line instead.
- Pie legend position / visibility from Style → Legend (XY only today); the pie legend is always shown (right, or below under 420 px).
- Map-key samples: three queries (one per Map column) are kept; merging them into one sample query would save two more requests but changes the shared, per-column cached key sampler.
- Lens's KQL compile does not use the table's text skip indexes (unchanged; Discover does).
