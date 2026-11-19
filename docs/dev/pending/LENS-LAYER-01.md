# LENS-LAYER-01 pending notes (#28)

**SQL added, chart SQL unchanged.** `queryShape` strips `layers`, so the chart query never re-runs for them. Two new read-only queries (`compile.ts`, op `lensLayers`): `compileReferenceValues` (computed reference lines: the metric compiler's aggregates over the chart's own WHERE conditions, one row, no GROUP BY) and `compileAnnotationQuery` (query annotations: each KQL through the search bar's compiler via `filterCond`, time conditions only, `LIMIT 100 BY k`). Field expressions pass `sanitizeLens` (computed lines on undiscovered fields are dropped) and `quoteIdentifier`. Needs `/security-review`.

## CHANGELOG

### Added
- **Layers on Visualize** (#28, LENS-LAYER-01; spec 20-lens.md "Layers"). XY charts (bar, line, area) get `+ Add layer` below the dimensions → `Select layer type`: Reference lines, Annotations (time charts only), Visualization (shown, not available yet). Each layer is a card with ⋮ layer actions Duplicate layer, Clear layer, Remove layer; its items open an editor that replaces the panel (`← Back`), like Style.
  - **Reference lines:** Static value (a new line starts at the data's highest value) or Computed (Count, Average, Sum, Minimum, Maximum, Median, Unique count of a field, over the chart's query, filters and time range); Label, Color, Axis side Left / Right, Line style Solid / Dashed / Dotted, Fill None / Above / Below. A line beyond the data widens the axis so it stays visible.
  - **Annotations:** Static date (a point in time or a range with an End date) or Query (KQL; marks the newest 100 matching documents in the time range, ignoring the chart's query and filters as in Kibana's default); Label, Color. Drawn as dashed vertical markers (ranges as shaded bands) with a hover title.
  - Layers live in the chart (`lens` URL param, draft), survive switches between bar / line / area, and carry over to exported dashboard panels as Grafana thresholds (static left-axis reference lines).

### Changed
- The Style toolbar button uses the `palette` icon and the Intervals granularity slider has an `inputId` (fixes two typecheck errors on the base, same change as in `feat/shared-a11y-01`).

## Decision

LENS-LAYER-01 (#28). Extra layers are one optional list on the chart, `LensState.layers` (`src/lens/layers.ts`): `referenceLine` layers hold lines (static `value` or `computed: {op, field}`), `annotations` layers hold manual (`time`, optional `end`) or query (`query` KQL) annotations; at most 5 layers × 10 items. Untrusted input (URL, draft) goes through `cleanLayers` in `decodeLens`: known kinds and keys only, finite numbers, times within 1970–2200, an `end` only after its start, `#rrggbb` colours, labels capped at 120 characters (rendered as SVG text, never markup), queries capped at 1,000 characters, computed ops from a fixed list, ids `[A-Za-z0-9_-]{1,64}` (bad or repeated ids are replaced). The editors build every change through `cleanLayers` too, and the KQL / number / date inputs validate before applying. `sanitizeLens` drops computed lines whose field is not a discovered field (same rule as dimensions). Layers are display-only for the chart query (`queryShape` strips them); computed values and annotation events come from two separate queries (`useLayerData`, keyed on their own inputs, op `lensLayers`, so the Inspector's chart requests stay the chart's), and a failure just leaves those lines / markers out. Query annotations ignore the chart's own query and filters (Kibana's default "ignore global filters") and use the standard time conditions. Rendering stays in `XyChart`: lines on their value axis (the left one when no series uses the right), annotation markers only on a time X axis of a vertical chart, positioned within the buckets like the brush. Switching between XY types keeps layers; Metric / Table / Pie drop them. Export (`render/layerConfig.ts`): static left-axis lines → `fieldConfig.defaults.thresholds` with `custom.thresholdsStyle` (`line`, `dashed` when every line is dashed / dotted, `+area` when every line fills above); labels, computed lines, right-axis lines (when the chart has a right axis) and annotations have no panel-level Grafana equivalent and are not exported.

## TESTING

| Case | Status |
| --- | --- |
| `cleanLayers`: known keys only; hostile labels / ids / colours / non-finite values / out-of-range times / inverted ranges / unknown ops and kinds / over-long queries dropped or capped; layer and item caps; URL codec round-trip; hostile layers dropped (jest `layers.test.tsx`) | ✅ |
| `sanitizeLens` drops computed lines on undiscovered fields; `queryShape` strips layers; XY switches keep them, Table drops them (jest) | ✅ |
| Layer actions: add, clear, duplicate (fresh ids), remove, upsert, caps; `resolveLayers` before / after computed values and events (jest) | ✅ |
| SQL: computed values (quoted hostile field, chart conditions, one row), annotation query (KQL compiled and escaped, empty = all, invalid = none, `LIMIT 100 BY k`), row shaping (jest) | ✅ |
| XyChart: line with label as text (markup not rendered), dashed + fill, axis widened for a line above the data, annotation point / range positions, none off-plot or on a category axis (jest) | ✅ |
| LayersSection / LayerItemEditor: Select layer type (Visualization disabled, Annotations need a time axis), add items with defaults, layer actions, static value / invalid number, computed field pick, style / fill / axis / label, annotation date + range validation, KQL refused, type switches (jest) | ✅ |
| Dashboard export: thresholds steps / colours / dashed+area, computed and right-axis lines skipped, mixed styles, no layers unchanged (jest) | ✅ |
| E2E (`tests/features/lens-layer-01.spec.ts`): add static line via Add layer with label + dashed style, kept in URL with no new chart query and across reload, Back; invalid value refused, computed Count = fixture total; manual range annotation and KQL query annotation (invalid refused, 100 payments markers); duplicate / clear / remove layer; hostile shared layers | not run (coordinator) |

## Deferred
- **Extra Visualization layer** (another series set with its own data view / chart sub-type): needs multi-query compilation, a second dimension editor and per-layer series merging in `XyChart`; the menu shows it disabled.
- **Layer settings ⚙ (random sampling)** for the data layer.
- Annotation extras from Kibana: "ignore global filters" toggle (always on), text / tooltip fields from the matched documents, icons and line width; grouping of dense query markers.
- Reference line extras: icon, text position, line width; a computed line with Filter by / percentile.
- Dashboard export of annotations (Grafana annotations are dashboard-level queries or stored events) and of computed / labelled reference lines.
- Annotations on horizontal bars with a date axis.
