# R3-CHARTS pending notes

**No change to SQL generation.** `compile.ts` is untouched; the new chart types read the rows the existing query returns (a chart-type switch with the same dimensions compiles the same SQL, verified in jest and by the request count in e2e). New untrusted input: the `lens` URL / saved-panel state gained `chartType` values `donut` / `heatmap` / `gauge` (whitelist), `gauge` options (`cleanGauge`: `shape: 'bar'`, finite `min` / `max` under 1e15, `bands: 'low' | 'high'`, everything else dropped) and `parked.metrics` (the same metric cleaner as visible metrics, factored out as `cleanMetrics`, capped at 8, and `sanitizeLens` drops parked metrics whose fields aren't discovered fields). Dashboard export adds Grafana transformations only (`groupingToMatrix`, `organize`, `rowsToFields`, `configFromData`); the panel SQL is the same compiled Lens SQL.

## CHANGELOG

### Added
- **Four chart types in Visualize (R3-CHARTS):** **Bar horizontal** (its own switcher entry; top values with long labels, largest on top, the category axis sized to the labels with `…` and the full text on hover), **Donut**, **Heat map** (e.g. errors per service over time: rows in rank order, colour legend, empty cells distinct from 0, tooltip, click-to-filter, keyboard grid) and **Gauge** (arc or horizontal bar, one per Break down by value up to 12, maximum from the Maximum value metric, a typed number or automatic, optional colour bands).
- Each saves to a dashboard as the matching native Grafana panel: barchart (horizontal), piechart (donut), heatmap (time on X; a colour-coded table matrix for categories on X), gauge / bar gauge.
- Suggestions: `Heat map` for a date histogram with a category breakdown, `Bar horizontal` for top values on X, `Gauge` for a Metric with a Maximum value.

### Changed
- A chart switch now also parks the metrics the target can't show (Pie / Donut / Heat map / Gauge show one) and restores them on the way back; a Maximum value metric is parked with its role instead of becoming a plain metric on Bar / Table.
- Bar horizontal's dimension groups read `Vertical axis` (categories) and `Horizontal axis` (metrics).

## Decision

R3-CHARTS (Kibana comparison round 2, #15). Four types only, each chosen for root-cause work on logs; Treemap / Mosaic / Waffle (part-of-whole variants Pie and Bar percentage already cover), Tag cloud (no core Grafana panel, poor for log values), Region map (no geo data) and Legacy metric (deprecated) are not offered. **Bar horizontal** is a switcher entry over the existing `style.orientation` flag rather than a new `ChartType`: the custom XY chart already drew horizontal bars and the export already set `orientation`, and one flag keeps the switcher and Style → Bar orientation consistent (`chartKind` / `switchKind` in `suggest.ts`). Kibana 9.5 itself lists Bar once (orientation in Style) and Pie once (donut in its options); separate entries make both findable from the search box. **Heat map** is custom-drawn (`render/HeatmapChart.tsx`) instead of PanelRenderer + Grafana `heatmap`: Grafana's heatmap needs a numeric / time X and numeric Y buckets (categories become ordinals in name order), and PanelRenderer has no cell-click callback; the custom grid gives rank-ordered rows, theme ramps, empty-vs-zero and the XY filter chooser. Dashboards get Grafana's heatmap for time X (rows re-ordered with `organize.indexByName` from the series Visualize showed) and a colour-background table matrix for category X. Ramps are single-hue blue (light → dark on light themes, dark → bright on dark), linear from min(0, lowest); linear keeps the incident row dominant, which is the RCA question. **Gauge** uses Grafana's `gauge` / `bargauge` through PanelRenderer; arc gauges are drawn one PanelRenderer per cell in an even grid because Grafana's repeater enlarges the last row's gauges (the same value looked bigger), and a lone bar gauge is bullet-sized under the metric name. Max per gauge: Maximum value metric (per row; export `rowsToFields` with a `max` mapping, or `configFromData` on the same query for one row — both checked on a Grafana 13 dashboard), else typed, else a round number above the largest value (Kibana suggests 1,500 for 1,292; ours 1,500 too). Colour bands are percentage thresholds at 70 / 90 % (low-is-good for error rates vs an SLO, or mirrored). Donut has no centre total: Grafana's piechart has no centre label and the legend width needed to place an overlay is not exposed. Metrics a target can't show are now parked like buckets (`parked.metrics`), which also makes Pie → Bar restore the hidden metrics.

## TESTING

| Area | Row |
| --- | --- |
| Jest | `src/lens/__tests__/r3Charts.test.tsx` (26: cleanGauge / decode / sanitize incl. hostile gauge and parked metrics; switchChart remapping for heat map / gauge / donut incl. parking and restore; same SQL across switches; Bar horizontal kind, title, groups, axis width, truncation; suggestions; switcher list; donut / gauge panel specs, auto max, bands, grid columns; heat map helpers; HeatmapChart cells, empty vs zero, tooltip, click / keyboard select, legend; export of all four), `ChartTypeSwitcher.test.tsx` (10 entries, Bar horizontal by keyboard) |
| E2E | `tests/features/r3-charts.spec.ts` (5 tests) — run once by the agent on its own container (all passed); coordinator: not run |
| E2E | Updated `lens-type-01.spec.ts` (option regex excludes "Bar horizontal"), `lens-chart-01.spec.ts` (Maximum value parked on Metric → Bar), `parity-xychart.spec.ts` (Bar option) — run once by the agent with `lens-style-01` / `lens-save-01` (all passed); coordinator: not run |
| IT | Chart switch to / from every new type sends no request when the SQL doesn't change (e2e heat map / bar horizontal / gauge tests count `/api/ds/query`) |

## Deferred
- Donut total in the centre (no Grafana piechart support).
- Heat map cell value labels and a log colour scale (not needed for the RCA case; Kibana has both as options).
- Gauge goal value (Kibana's third gauge metric); vertical bullet shape.
- Dashboard export of a heat map with categories on X is a colour-coded table, not cells.
