# Kibana comparison fixes (LENS-SAVE-02, LENS-TYPE-01 parking, default time range)

**SQL:** unchanged for charts. Edit in Visualize stores Visualize URL parameters (not SQL) on exported panel targets; the panel's own SQL is built exactly as before.

## CHANGELOG

### Added
- **Edit in Visualize from a dashboard panel** (LENS-SAVE-02; spec 20-lens.md). Panels added to a dashboard from Visualize get `Extensions → Edit in Visualize` in their panel menu (Kibana's "Edit visualization in Lens"): it reopens the chart in Visualize with its dimensions, query, filters and data view, and the dashboard's time range. The panel stays a normal Grafana panel. Other panels don't show the item. Requires a Grafana restart (plugin.json declares the new link).
- **Default time range setting** (spec 30-shared.md SHARED-STATE-02; Kibana's `timepicker:timeDefaults`). App config → `Default time range` (From / To, time expressions or absolute dates): the range Discover and Visualize open on when a link carries none. Dev provisioning opens on the fixture window (2026-01-01 → 2026-01-08 UTC).

### Changed
- Visualize no longer repeats the data view's table next to the data view picker; the table is in the picker's tooltip. The carried query / filter summary shows only when there is one.

### Fixed
- **Visualize: switching to Metric (or Pie) lost the date histogram and there was no way back** (LENS-TYPE-01). The dimensions a chart can't show (a date histogram on Metric / Pie, an XY chart's Style and layers) are now parked and come back when switching to a chart that can show them. Dropping a time field on Metric / Pie returns to the time chart; it used to be silently dropped again.
- Visualize: a time field dropped on a bucket slot (Horizontal axis, Break down by, Rows) makes a date histogram instead of top values of timestamps.

## Decision

Kibana comparison fixes (user requests, 2026-11-19). (1) **Parked dimensions:** `LensState.parked` = `{ chartType, subType?, buckets, style?, layers? }`, written by `switchChart` for whatever the target can't show (a dropped date histogram always; other buckets only when the target is Metric / Pie) and read back on the next switch (a parked date returns to X, other buckets after the visible ones; Style / layers only on XY). `chartType` is the last chart that could show them, so a time field dropped on Metric goes back there (`addTimeBucket`, used by both the workspace drop and bucket slots). Parked state rides in the `lens` URL param: `cleanParked` keeps known chart types, at most 8 buckets through the same `cleanBuckets` as visible ones, and `cleanStyle` / `cleanLayers`; `sanitizeLens` drops parked buckets and computed lines on fields the view lacks; `queryShape` strips it, so parking never re-runs the query. (2) **Edit in Visualize:** the panel keeps its Visualize state as URL parameters on its query target (`observeVisualize`), not a separate store, so it survives dashboard export / import and needs no backend; a `grafana/dashboard/panel/menu` link extension (declared in plugin.json) shows only when a target has it. Dashboard JSON is untrusted: `editInVisualizePath` passes only `lens`, `q`, `filters`, `ds`, caps the value at 16,000 characters, always builds the path under the plugin's own route, and Visualize decodes / sanitizes it like a shared link. Time comes from the dashboard, as in Kibana. (3) **Default time range:** `jsonData.defaultTimeRange` (admin config), cleaned by `cleanDefaultTimeRange` (strings ≤ 64, both parse with Grafana dateMath, from < to, else the last hour) and provided by App through `DefaultTimeRangeContext`. Kibana's comparison stack opening on the data was its `timepicker:timeDefaults`, not an automatic data-range search, so the equivalent here is the same kind of setting. (4) The Visualize toolbar's `database.table` label is gone; the active table is in the picker's `title`.

## TESTING

| Case | Status |
| --- | --- |
| Parking: Bar over time → Metric → Bar restores the same date histogram and breakdown; Metric → Pie → Line; time field dropped on Metric returns to Bar with the parked date; from-scratch Metric + time field → line; time field on a bucket slot → date histogram; not in `queryShape`; URL round-trip; hostile / oversize parked input; `sanitizeLens` (jest `parked.test.ts`) | ✅ |
| Layers park on Table and come back on Bar (jest `layers.test.tsx`, updated) | ✅ |
| Edit in Visualize: exported target carries the source; path has chart, query, filters, view, dashboard time (relative and absolute); hidden without a source / without a chart; unknown params dropped, oversize refused, path stays under the plugin route (jest `panelSource.test.ts`) | ✅ |
| Default time range: relative / absolute kept; missing, junk, inverted, oversize, injection-shaped fall back to the last hour; resolves to a TimeRange (jest `defaultTimeRange.test.ts`) | ✅ |
| E2E `tests/features/lens-save-02.spec.ts`: save to a new dashboard → panel menu → Extensions → Edit in Visualize reopens the chart with query and view; a plain panel has no item | ✅ |
| E2E `lens-dataview.spec.ts` updated: the active table is asserted on the picker's tooltip | full run |

## Deferred
- Kibana's "Save and return" from Visualize back to the dashboard (replacing the original panel in place); Edit in Visualize opens a fresh Visualize session and saving adds a new panel.
- An automatic "time range with data" when the default range is empty (Kibana doesn't do it either; its Discover offers a "search entire time range" action, not implemented).
