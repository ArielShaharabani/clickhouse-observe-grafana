# LENS-DIM-02-ADV pending notes (PLAN 16g)

## CHANGELOG

### Added
- **Metric Advanced options** (PLAN 16g, spec 20-lens.md LENS-DIM-02 "Advanced"): a collapsible Advanced section in the metric editor.
  - **Filter by**: KQL applied to this metric only, compiled by the search bar's KQL compiler into a conditional aggregate (`countIf`, `avgIf`, `quantileIf`, …). Invalid KQL stays in the box with a message.
  - **Time shift**: presets 3h, 6h, 12h, 1d, 1w, 1M, 3M, 6M or a typed `<n><unit>` (s m h d w M y). One query reads each row once per distinct shift (`ARRAY JOIN` over a copy index), moves its time forward by the shift, and checks the window on the shifted time; each metric aggregates only its own copy. The label shows `(1d ago)`.
  - **Reduced time range**: only the last span of the time range counts (presets 30s, 1m, 5m, 15m, 1h or typed); as in Kibana, not available with a date histogram.
  - **Normalize by unit**: per second / minute / hour / day of the date bucket. The value is scaled by unit ÷ bucket width (`$__interval_s` in saved panels). Needs a date histogram.
- **Metric Appearance options** (LENS-DIM-02 "Appearance"):
  - **Value format**: Default, Number, Percent, Bytes (1024), Bits (1000), Duration (input unit ms/s/m/h) and Custom format (numeral-style pattern such as `0,0.00`, `0.0a`, `$0,0`, `0.0%`), with decimals. It applies to tooltips and axis ticks on XY charts, and to the Grafana unit and decimals on metric, table and pie charts and exported dashboard panels.
  - **Series color**, used when the chart has no breakdown.
  - **Axis side** Left / Auto / Right on unstacked line, area and bar charts, which then get a right axis with its own scale and format. Exported panels set `axisPlacement`.
- Format, colour and axis side are display-only and don't re-run the query.

## Decision

LENS-DIM-02-ADV (PLAN 16g).

**Options are stored on `MetricDim`, validated on decode.** The options live on `MetricDim` (`MetricOptions` in `src/lens/metricOptions.ts`). `decodeLens` now rebuilds every metric from known keys only: before this, quick-function metrics passed through with any extra keys. `cleanMetricOptions` validates each option:
- shift and reduced range must parse as `<1–99999><unit>` within 10 years, and are stored canonical;
- the colour must be `#rrggbb`;
- enums are checked, and a custom pattern must match the numeral grammar.

**SQL is printed only from parsed values.** SQL uses only the parsed integer and a fixed unit keyword (`chInterval`), never the text. Filter by goes through `kqlToSql`, which escapes values and resolves fields. In dashboard mode a `$` in a Filter by becomes `\x24`, as for formula `kql=`.

**Time shift is one query (ARRAY JOIN), not one query per shift.**
- `compileLens` swaps the standard time condition (and its coarse partition bound) for two things: a prefilter that ORs the main window with each shifted window, and an exact check on the shifted time.
- Date buckets use the shifted time. In dashboard mode that is the explicit `toStartOfInterval(…, $__interval_s)` form, not `$__timeInterval`.
- Each metric's aggregate is conditioned on `__s = k`. Formula metrics get `__s = 0` through the new `FormulaSqlContext.rowCond`, which every aggregate in the formula ANDs with its own `kql=`.
- Ranking by count uses `countIf(__s = 0)`.
- A top-values CTE still ranks over the unshifted window.

**Filter by, shift and reduced range don't apply to formulas.** Formulas have their own `kql=` argument, and `shift=` remains deferred. The editor points users to the arguments.

**A metric's Filter by also applies when a top-values bucket ranks by that metric.**

**Appearance:**
- XY charts are custom SVG, so `XyChart` applies the format, the colour (only without a breakdown) and a right axis. Stacked charts keep one axis, since stacks are per axis in Kibana and mixing them is confusing.
- PanelRenderer charts and exported panels use one shared mapping, `withMetricAppearance`. With one metric the options go in field defaults; with several, each metric gets a `byRegexp` override on its label.

**Function changes keep the options.** `withOp` and `formulaMetric` carry them over, so a switch never loses them.

## TESTING

| Case | Status |
| --- | --- |
| Span parser rejects sign / decimals / unknown unit / injection text; formats (number, percent, bytes, bits, duration, custom) and Grafana units; `cleanMetricOptions` / `decodeLens` drop unknown keys and invalid values; options survive a function change; labels (jest `metricOptions.test.ts`) | ✅ |
| Filter by → conditional aggregate, escaped values, invalid KQL → `countIf(0)`; time shift ARRAY JOIN / copy conditions / window prefilter; tampered shift never reaches SQL; formulas get `__s = 0`; reduced range (not with a date histogram); normalize (app constant, dashboard `$__interval_s`); `$` escaped in dashboard mode (jest `metricOptions.test.ts`) | ✅ |
| Generated SQL (shift + filter + normalize + formula + breakdown; reduced range + month shift percentile; dashboard shift) runs on ClickHouse 26.3 against the fixture (manual, read-only) | ✅ |
| Field config defaults / per-metric overrides, no colour with a breakdown, metric/table panels and exported dashboard panels; XyChart colour, format and right axis; editor: KQL validation, shift presets / typed / garbage, reduced range disabled with a date histogram, normalize, formula note (jest `metricAppearance.test.tsx`) | ✅ |
| e2e `tests/features/lens-dim-02-adv.spec.ts`: Filter by gives per-service error counts and lands in the URL; invalid KQL not applied; time shift preset → ARRAY JOIN + "(1d ago)" label; tampered shift in a link never reaches SQL; XY right axis with Bytes format and fixed colour | ⏳ (coordinator) |

## Deferred

- Time shift and reduced range inside formulas (`shift=` / `reducedTimeRange=` arguments).
- Value format on the date histogram axis and in Discover-style number fields.
- Right axis on stacked charts.
- A colour picker with Grafana's palette (a native colour input is used).
