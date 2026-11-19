# PARITY-CHARTS2 (Visualize Pie / Metric / Table / dimension editor / export / Inspector)

SQL impact: new top-values buckets default to `other: true`, so their query uses the Other grouping (same SQL shape as the existing option). No other query changes.

## CHANGELOG
- Pie: distinct stable colour per slice (as in XY), "name NN%" labels, grouped legend values.
- Metric: a single tile is centred at a Kibana-like size; per-value tiles in a 3-column grid with the metric name as subtitle.
- Table: thousands separators and wrapped headers.
- Top values: "Group remaining values as Other" on by default for new breakdowns.
- Dimension editor no longer clips at 1440 px.
- Dashboard export: XY series keep their Visualize colours.
- Inspector: SQL shown as text, "Result rows" instead of "Hits", ClickHouse stats only when present, metric value format in the Data view.

## Decision
Pie is drawn by Grafana's piechart with one field per slice so each gets a fixed colour; Grafana's percent label has no decimals option, so "NN.NN%" is "NN%". Export colours use the series of the chart on screen at save time (names are data, unknown to the pure builder).

## TESTING
| Check | Spec | Result |
| Pie colours / labels, tiles layout, table format, editor not clipped, Inspector SQL | tests/features/parity-charts2.spec.ts | not run (coordinator) |

## Deferred
- Pie percent with 2 decimals (Grafana label limitation); pie panels in dashboard export are not coloured per slice.
- Row-number column (none is drawn).
