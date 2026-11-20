# R2-VIZ-POLISH (Kibana comparison findings 22-24)

## CHANGELOG bullets
- Visualize: the dimension editor's footer (Remove dimension / Close) is pinned to the bottom of the side panel, so it stays visible when the editor (for example Top values) is taller than the viewport; only the body scrolls.
- Visualize pie: when a slice is under 5% of the total the on-slice labels are dropped (they overlapped, "warn 8%" over "debug 6%") and the legend shows value and percent for every slice.
- Visualize time axis: the last tick label is no longer clipped at the right edge (a tick whose label would not fit is dropped, so an 8 h range ends on 13:00), and Line / Area no longer slope down to 0 over an empty partial edge bucket.

## DECISIONS (append to D49 / D47 area)
R2-VIZ-POLISH. (1) **Pinned editor footer**: the dimension editor footer is `position: sticky; bottom: 0` inside the scrolling Dimensions column (all editors share `DimensionEditor`), with an opaque background and a top border. (2) **Pie labels**: Grafana 13's piechart options (`displayLabels` name / percent / value, legend `values` percent / value, `pieType`, `sort`) have no label rotation, no per-slice label switch and no decimals for the percent. So `pieDisplayLabels` returns `[]` for the whole pie when any non-empty slice is under 5% (`PIE_LABEL_MIN_SHARE`), else `['name','percent']`; the legend always has `['value','percent']`. Kibana's two-decimal percent stays unreachable (Grafana's own formatting). (3) **Time ticks**: tick labels are left-anchored at the tick, so `fitTimeTicks` drops ticks whose estimated label width (6.5 px per character + 3 px) passes the chart's right edge (the date row moves to the next tick if the first one is dropped); rotated labels (end-anchored) are not filtered. (4) **Partial edge buckets for Line / Area**: a partial first / last bucket in which every plotted series is 0 (a zero-filled sliver, for example a picker range ending 1 s past a round hour) is not drawn, so the line ends on the last bucket with data; a partial bucket with real data is still plotted at its actual value and shaded, as Kibana does. Bars are unchanged.

## TESTING rows
| Area | Test |
|---|---|
| fitTimeTicks drops the clipped last tick (14:00 to 13:00), keeps date row | `src/lens/__tests__/vizPolish.test.ts` |
| pieDisplayLabels hides labels for slices under 5% | `src/lens/__tests__/vizPolish.test.ts` |
| e2e: no time tick label past the chart's right edge | `tests/features/parity-xychart.spec.ts` (time axis) |
| e2e: pie legend shows percent | `tests/features/parity-charts2.spec.ts` (pie) |
| Manual (not automated): at 1440x860 the Top values editor keeps Remove / Close visible | Visualize, click a Top values bucket |
