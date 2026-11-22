SQL impact: none (display-only change to the inspected SQL text; queries are unchanged).

## CHANGELOG
- Visualize is wrapped in `PluginPage` (as Discover is), so the side-menu entry is marked active whenever the page is open.
- An empty Visualize workspace shows the dimension slots (Horizontal axis / Vertical axis / Breakdown) with add buttons.
- Removing the only horizontal axis of a line/area/bar/heatmap keeps the chart type and shows an empty visualization instead of switching to Metric.
- Inspect SQL shows the macro-expanded SQL: Discover expands `$__fromTime`/`$__toTime` with the time range; Visualize's Inspector leads with `executedSql` and keeps the macro form after it.

## Decision
- The nav highlight bug is fixed by `PluginPage`; the Configuration entry is a Grafana core page (/plugins/<id>) and is not changed by the plugin.
- Raw (macro) form kept in the Visualize Inspector only (one extra block); Discover shows expanded SQL only. Raw-SQL seeding still uses the macro form.
- Adding a metric to an empty bar still adds the time axis automatically (existing rule 3).

## TESTING
| Spec | Result |
| tests/features/r5-viz-state.spec.ts | not run (coordinator) |

## Deferred
- Configuration tab highlight inside Grafana's plugin page is core-owned; not reproducible/fixable from the plugin.
