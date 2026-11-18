# LENS-STYLE-01 pending notes (#27)

**No SQL changed.** Style and Legend are display-only: `queryShape` strips `style`, so changing a setting never re-runs the chart query.

## CHANGELOG

### Added
- **Style and Legend panels on Visualize** (#27, LENS-STYLE-01; spec 20-lens.md "Style and Legend panels"). XY charts (bar, line, area) get `Style` and `Legend` toolbar buttons above the dimension panel; each swaps the panel for a settings view with `← Back`.
  - **Style → Appearance:** Bar orientation Vertical / Horizontal (horizontal bars put the categories on the left and the values along the bottom).
  - **Style → Titles and text:** Bar values Hide / Show, if able (a value is drawn on a bar segment only when it fits).
  - **Style → Left / Bottom / Right axis:** Axis title None / Auto / Custom (Auto = the metric names on the value axis, the bucket on the category axis), Gridlines, Tick labels, label Orientation Horizontal / Vertical / Angled; on value axes Axis scale Linear / Logarithmic / Square root, Bounds Full / Data / Custom (lower / upper, validated; Data is off for bar charts, as in Kibana) and Round to nice values. The right axis section appears when a metric is on the right axis (LENS-DIM-02).
  - **Legend:** Visibility Auto / Show / Hide (Auto hides a single series without a breakdown, as in Kibana), Position Outside / Inside, Alignment (outside: Right / Left / Top / Bottom; inside: a corner of the plot), Layout List / Grid.
  - Settings live in the chart (`lens` URL param, saved chart, draft) and carry over to exported dashboard panels where Grafana has an equivalent (legend show / placement, axis label, gridlines, log scale, min / max, soft min 0 for Full bounds, bar orientation, value labels, x tick rotation).

### Changed
- XY charts show automatic axis titles, and the legend is hidden for a single series without a breakdown (Kibana's defaults). Every other default draws as before (legend below the chart as a list).

## Decision

LENS-STYLE-01 (#27). Style is one optional chart-level object, `LensState.style` (`src/lens/style.ts`), display-only and separate from the per-metric appearance (format, colour, axis side — LENS-DIM-02). Axes are stored **by role**: `left` = the value axis, `bottom` = the category axis, `right` = the right value axis; horizontal bars draw the value axis at the bottom and the panel relabels the sections accordingly, so flipping orientation never moves settings between axes. Untrusted input (URL, saved chart, draft) goes through `cleanStyle` in `decodeLens`: only known keys with known values survive, numbers must be finite, custom bounds must be ordered (an inverted pair is dropped), the custom title is capped at 120 characters and rendered as SVG text (never markup), and a legend alignment must match its position (an inside corner is not an outside side). The panel builds every change through `cleanStyle` too, and bound inputs validate against each other before applying, so the UI can't store what the decoder would drop. Defaults reproduce the old chart except Kibana's automatic axis titles and Auto legend. Rendering stays in the custom `XyChart` (click / brush interactions); value scales (`scalePos`, `valueDomain`, `valueTicks`) are pure and unit-tested; marks are clipped to the plot so custom bounds can't draw over the axes. Log scales need a positive domain: values ≤ 0 sit at the bottom and a domain starting at 0 starts at 1. Grafana mapping (`render/styleConfig.ts`, used by panel export and `panelSpec`) degrades where Grafana has no equivalent: legend top / left → bottom / right, inside → bottom, grid → list, square-root scale → linear, Data bounds → Grafana's auto range, category-axis title / ticks on time series not configurable. Brushing is off for horizontal bars (no time axis along x). Switching between XY chart types keeps the style; switching to Metric / Table / Pie drops it.

## TESTING

| Case | Status |
| --- | --- |
| `cleanStyle`: known keys only, bad values / inverted or non-finite bounds / long titles / mismatched legend alignment dropped; URL codec round-trip; hostile style dropped (jest `style.test.tsx`) | ✅ |
| Display-only: `queryShape` drops style; XY chart switches keep it, Table drops it (jest) | ✅ |
| Scales: value domains (full / data / custom / log / percentage), log and sqrt positions, ticks (jest) | ✅ |
| XyChart: auto titles, Auto legend, horizontal geometry, bar values, titles / ticks off, log ticks, custom bounds, legend right / inside / grid / hidden (jest) | ✅ |
| StylePanel: changes through `cleanStyle`, horizontal relabels the axes, Data bounds disabled for bars, Back, bounds order and junk not applied (jest) | ✅ |
| Dashboard export: barchart orientation / values / rotation / legend, axis label / gridlines / log / min / max (jest) | ✅ |
| E2E (`tests/features/lens-style-01.spec.ts`): horizontal + bar values kept in the URL with no new query and across reload, Back; custom / none axis title, log scale, custom bounds and refused inverted range; legend auto / show / right / inside corner / grid / hide; hostile shared style | not run (coordinator) |

## Deferred
- Legend extras from Kibana (truncate / max lines, show values in legend, legend width).
- Per-series line style (curve, points, line width) and fill opacity.
- Category-axis label truncation settings.
