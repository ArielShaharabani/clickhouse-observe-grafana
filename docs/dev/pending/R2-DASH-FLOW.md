# R2-DASH-FLOW (Kibana comparison findings 11, 13, 25)

## CHANGELOG bullets
- Visualize opened from a dashboard panel: "Save and return" is now one click (no confirm dialog); the panel keeps its title and description. A concurrent dashboard change is still reported (the dialog opens with the reason) and nothing is overwritten.
- "Cancel" asks "Leave with unsaved changes? / Discard changes" only when the chart differs from the panel it was opened from; no prompt when nothing changed.
- Visualize "Explore in Discover" opens in the same tab (browser Back returns to the chart); Ctrl/middle-click still opens a new tab.
- Share dialog short-link hint: "anyone who can open this Grafana can use it" (links work anonymously when anonymous access is on).

## DECISIONS
Dashboard flow (R2-DASH-FLOW). Save and return calls `saveAndReturn` directly from the toolbar with the panel's own title / description (`panelTitle || defaultTitle`), still with `overwrite: false` so Grafana's version check reports a concurrent change; on any failure the SaveLensModal opens with that error (`initialError`), where Save as new / retry are available. Cancel compares the chart's URL state (`lens`, `q`, `filters`, `ds`; time excluded) with the state captured when the dashboard panel finished loading, and shows a ConfirmModal only when they differ. Explore in Discover keeps its `href` (with the sub-path, so modified clicks open a new tab) but a plain click does `locationService.push`, so the state stays in the URL and Back returns to the chart. Only one Explore entry point exists in Visualize (the toolbar link).

## TESTING rows
| Area | Test | Where |
|---|---|---|
| Save and return one click | one click saves, no dialog, panel title kept | ParityDashboards.test.tsx (jest) |
| Save and return conflict | version-mismatch shown in the dialog, no navigation | ParityDashboards.test.tsx; parity-dashboards.spec.ts "reports a concurrent change" |
| Cancel | no prompt unchanged / time-only change; prompt after a chart change | ParityDashboards.test.tsx; parity-dashboards.spec.ts (two Cancel tests) |
| Explore in Discover | same tab, bucket columns, Back returns to chart | lens-interact-02.spec.ts IT-H |
