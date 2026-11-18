# LENS-CHART-01 pending notes (#26 Table and Metric specifics)

**No query SQL changed.** Every option here reshapes or decorates the rows the existing Lens query returns; `queryShape` ignores them, so changing one never re-runs the query.

## CHANGELOG

### Added
- **Table: Split metrics by** (LENS-CHART-01; spec 20-lens.md "Table: groups Rows / Split metrics by / Metrics"). A Table now has three groups. Buckets in *Split metrics by* turn their values into metric columns (`error › Count of records`, one column per value × metric, in first-seen order, capped at 100 value combinations); *Rows* keep one row per value combination. A row without a combination shows an empty cell, not 0. Moving a bucket between the two needs no new query.
- **Table: Summary row** per metric column (None, Sum, Average, Value count, Minimum, Maximum — Grafana table footer reducers) and **Color by value** (None / Cell / Text, continuous green-yellow-red scale), in the metric editor when the chart is a Table. Both apply to every pivot column of that metric and carry over to the exported dashboard panel.
- **Metric chart tiles**: a grid of tiles (one per *Break down by* value, or one tile) with the label top-left and the big value bottom-right in the metric's Value format; a tile without a value shows a dash. The *Secondary metric* is shown under the label, and the new **Maximum value** group draws a progress bar (primary ÷ maximum, capped at 100 %). The primary metric's series colour colours the value and the bar.
- Table and Metric options are kept in the URL / saved chart (`pivot` on buckets; `summary`, `colorBy`, `role: "max"` on metrics). Unknown or ill-typed values from a link are dropped.

### Changed
- The Metric chart renders its own tiles instead of Grafana's Stat panel (`data-panel="tiles"`). Exported dashboard panels still use Stat.
- Switching chart type drops Table pivots and the Metric chart's Maximum value role (they become ordinary rows / metrics); a Metric chart left with only a maximum gets a Count of records as its primary metric.

## Decision

LENS-CHART-01 (#26). Chart-specific roles are flags on the existing dimension lists, not new lists: a bucket's `pivot: true` puts it in *Split metrics by* (Table), a metric's `role: 'max'` puts it in *Maximum value* (Metric chart). `dimensionGroups` filters by the flag, a group's `tag` sets it when adding, and `switchChart` strips the flags when leaving the chart type that gives them meaning. This keeps compile.ts untouched: the SQL groups by every bucket and aggregates every metric exactly as before, and the pivot happens on the shaped rows (`tableColumns`, `src/lens/tableChart.ts`). Summary row / colour by value map to Grafana table field-config overrides matched by column name (`custom.footer.reducers`, `custom.cellOptions`), so sorting and resizing stay Grafana's. The Metric chart is drawn by `MetricTiles` (`src/lens/render/MetricTiles.tsx`) because Grafana's Stat panel has no secondary value or per-tile progress against another metric. Not done (deferred): the trend line under a tile (needs a second, date-bucketed query), filter-for/out actions on table cells (the Inspector's Data view has them), pivot in exported dashboard panels (Grafana's grouping-to-matrix transform handles one column field and one value only), summary label text.

## TESTING

| Case | Status |
| --- | --- |
| Pivot: one row per row-bucket value, one column per pivot value × metric, missing combination empty, cap 100; no pivot → unchanged; table panel gets the pivoted frame (jest `chartSpecifics.test.tsx`) | ✅ |
| Summary / colour overrides per (pivot) column, avg → mean, text colouring, no option → no override, exported panel carries them (jest) | ✅ |
| Metric tiles: per breakdown value, secondary metric, progress against maximum (0 max → no bar, capped 100 %), value format, empty → dash, rendered progressbar (jest) | ✅ |
| Groups / add to Maximum value / add to Split metrics by / switchChart drops roles / display-only options keep the query shape / URL round-trip and hostile values dropped (jest) | ✅ |
| Table pivot on the fixture (error column, payments errors, one row per service); summary Sum footer = total and colour by value without a re-query; Metric tiles with secondary + progress (payments ≈ 17 %); Maximum value add + switch to Bar; hostile link values dropped (`tests/features/lens-chart-01.spec.ts`) | e2e not run (coordinator) |
| Metric chart switch now renders `data-panel="tiles"` (`lens-type-01.spec.ts` updated) | e2e not run (coordinator) |
