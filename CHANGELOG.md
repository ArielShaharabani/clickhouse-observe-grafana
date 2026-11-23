# Changelog

All notable changes to this project will be documented here.

Versions track the plugin's release history. `Unreleased` collects commits not yet tagged.

---

## [Unreleased]

---

## [0.80.0] — 2026-11-23

- Discover: opening a document keeps the field list open, and the document panel pushes the histogram and grid aside instead of covering them (as Kibana). On pages up to 1100 px wide, or expanded, it still goes over them.
- Discover: click any cell to expand its value (click again to close). Cells show a pointer and a tint; a cut-off value shows "Click to expand" on hover. Selecting text and the cell's buttons do not expand.
- Discover: Ctrl+F (or the search icon) finds text in a document's JSON and in an expanded cell value: next / previous (Enter, Shift+Enter, F3), match count, match case, whole word, regular expression. Folded JSON is unfolded.
- Fixed: the expanded cell popover did not take keyboard focus when opened with the mouse.
- Inspect SQL shows every query as it was executed (each time window the document search tried, loaded pages, the histogram), with real values, and Copy copies exactly that. Same in the Inspect drawer and the Visualize Inspector (raw SQL mode, running and failed queries too).
- Fixed: JSON keys with `:` (or other punctuation) were shown as SQL (`P."a:b".:String`) in filter pills and cell actions, and picked suggestions inserted `:`. Names are shown as in the field list; suggestions insert `a\:b`.
- Configuration: "Edit in Visualize links" finds ClickHouse panels without the link and adds it to the dashboards you tick (as a new dashboard version).
- Fixed (data loss): saving to a dashboard that uses Grafana's newer layouts (tabs, auto grid) would have flattened it; Save and return, Add to dashboard and the link tool now refuse with a message.
- Fixed: filtering on a JSON path holding a list of objects, or values of several types, failed with a ClickHouse error (pills, is one of, search bar). Such paths compare as text, lists with their JSON; Filter for on a list cell matches the whole list.
- Visualize has session tabs that work as Discover's (add, rename, duplicate, reorder, close, recently closed). A link opens in its own tab when the current one holds a chart; a dashboard panel's tab is named after it and closes on Cancel / Save and return. The side menu reopens the active tab's chart (an empty tab follows the last search).
- Fixed: a Visualize panel edited in Grafana's own editor could not be edited in Visualize. Grafana hides plugin menu items while a dashboard is in edit mode, so panels saved from Visualize now also carry an "Edit in Visualize" panel link, which stays. If the query or chart type was edited, Visualize reads the panel as it is now; what cannot be converted opens on the saved chart. Save and return warns when it would drop edits made in Grafana.

---

## [0.79.0] — 2026-11-23

- Fixed: switching data views could run queries with the previous view's auto-detected time column or fields ("Unknown identifier"), and its errors stayed on screen. Discovery is now tied to its table; errors, rows and unfinished search text are reset on a switch.
- Discover keeps filters across a data view switch: struck through and not applied on the new view, applied again on their own view, removed only by the user.
- Visualize: the last metric (vertical axis) can be removed; the workspace is empty until a metric is added, other dimensions stay.
- Fixed: search text typed before the field list loads gets suggestions once it does; the Discover pager wraps in a narrow pane instead of squeezing out the table.
- Replacing a dashboard panel fails safe: a panel not made in Visualize always warns unless it is known to convert fully.
- Visualize: the panel menu's "Edit in Visualize" is on every saved dashboard panel. Panels not made in Visualize are converted when Visualize opens (the link carries only the dashboard, panel and time, no SQL): raw-SQL and builder targets of the ClickHouse data source (one SELECT from one table: date buckets, top values, count / unique / sum / avg / min / max / median / percentile / standard deviation, GROUP BY, ORDER BY, LIMIT, simple AND conditions as filter pills), and panels exported from Discover (volume histogram). Chart type, unit, decimals, legend and gauge range carry over.
- Visualize: when a panel is not fully converted, a short note says so and offers the original query (read only, copyable). Joins, subqueries, CTEs, UNION, window functions, HAVING, OR, template variables, several queries, other data sources and other panel types give an empty chart with the reason.
- Visualize: any Save and return of a panel that was not fully converted (or could not be) first asks "Replace the original panel?", listing what would be lost, with "Save as new panel" (adds to the same dashboard, original untouched; primary), "Replace anyway" (version lock kept) and Cancel. Fully converted panels still save in one click. Opening a panel never changes the dashboard.
- Visualize: new "Open panel" action (next to Share / Save): pick a dashboard and a panel (rows included, with type; panels that cannot be converted are marked and say why).
- Dashboards in the newer v2 schema give a clear message instead of an error.
- Fixed: Visualize "Add layer" opened its menu at the far right of the dimensions panel instead of under the button. It and the layer actions menu now use Grafana's Dropdown + Menu (floating placement, flips near edges, Escape / outside click close, focus returns to the button).
- Fixed: the chart type list could run past the right edge or bottom of the window when the dimensions panel is narrow or the window is small; it now stays inside and its list scrolls.
- Fixed: the legend actions menu on Visualize charts now closes on a click outside it.
- Fixed: the data view picker and Saved searches menus now close on Escape.
- Security: dependencies updated to the latest compatible releases (all published at least 2 weeks ago); transitive advisories fixed in the lockfile and with scoped `overrides` (dompurify, js-cookie, moment, uuid, basic-ftp). Nothing flagged ships in `dist/module.js` except `react-router-dom` (see below).
- Security: matched-term highlighting no longer backtracks on a hostile shared-link query (many `*` wildcards) and scans at most 5000 characters per cell.
- Security: the remembered trace-view lookup ignores inherited keys (`constructor`, `__proto__`) and non-object storage values.
- CI/dev: release workflow uses `npm ci`, no persisted checkout credentials and no `${{ }}` expansion inside shell; `cp-update` gets `contents: read`; dev docker-compose publishes ClickHouse, Ollama and OTLP ports on 127.0.0.1 only.
- The time picker's "Change time settings" now works: the time zone and fiscal year start month you pick apply to every time shown in Discover and Visualize (grid, detail drawer, compare and surrounding documents, histogram axis / tooltip / caption / bucket menu, chart axes, tooltips, annotations, inspector). The default is Grafana's own preference; "Default" in the picker goes back to it. The choice is kept per browser.
- Relative ranges with rounding (`now/d`, Today, Yesterday, This week, fiscal ranges, shorthand `td`/`yd`/`tw`) resolve in the chosen zone and fiscal month, including from URLs, saved searches and saved queries; changing the zone re-resolves a relative range on screen. Absolute ranges keep the same instants.
- The query request carries the chosen zone.
- Fixed: hovering or drop-targeting a Discover table column header no longer shows scrolled rows through it (tint is an image layer over the opaque header; header now sits above row cell toolbars).
- Added: the histogram height is adjustable by a drag handle at its bottom edge (arrow keys, Home/End, double-click resets to 104); remembered per browser, never taller than ~60% of the window.
- Removed: the Language (KQL / Lucene) group from the query menu; Lucene is not implemented.
- Changed: Discover tabs are larger and shrink as more open, like browser tabs; the strip scrolls only when all tabs are at minimum width, and the active tab is scrolled into view.
- Changed: tab reordering uses pointer drag: grab anywhere on a tab, drop anywhere (also past the ends), neighbours move aside live, Escape cancels.

---

## [0.78.1] — 2026-11-22

- Replaced hard-coded px paddings/gaps with theme tokens in Emotion blocks:
  LogsExplorer rail button padding, SearchBar item badge padding, XyChart color-grid gap,
  PieChart legend item padding, VolumeHistogram legend row padding.
- Map/JSON fields (and their keys/paths) show a Map/JSON marker in place of the type icon, left of the name, in the
  Discover sidebar and the Visualize field list; the right-side badge (covered by the filter buttons) is gone.
- Visualize dimension editor: fields scroll in their own area; the Remove/Close footer no longer overlaps the aggregation options.
- Discover and Visualize share one header (data view, Schema, Add filter, search, Explore-in-other-app, time controls,
  action row) at identical positions, so switching pages doesn't move anything. Visualize gained Discover's page padding
  and a refresh-interval picker.
- Fixed: the Discover search bar overflowed when "Update" was shown, hiding it under the Explore link; fast typing after
  accepting an autocomplete suggestion moved the caret back.
- Review fixes (batch 12): KQL and filter pills share one per-field predicate (`sql/fieldPredicates.ts`), so the
  "exists" / "does not exist" pills now work on JSON array paths (`[]` counted as present) and whole JSON columns (`{}`),
  and an is / is-not pill on a whole JSON column matches nothing instead of failing. Filters on a dynamic JSON path read
  as a typed subcolumn (`.:Int64`, typed from a 1,000-row sample) now compare the bare path as text
  (`toString(Payload.x)`, `toFloat64OrNull(toString(...))` for ranges): rows holding another type (e.g. `"503"`) are no
  longer dropped as NULL, and a non-numeric value no longer fails the query; GROUP BY / aggregates and array paths keep the
  typed read (required there), so a value of another type still reads as empty in charts and top values. A float compares
  by its text (`1.5`, not `1.50`). The full-range value lookup no longer aliases its result as `value` / `count` (shadowed a
  real column of that name in the caller's filters) and accepts quoted column names again. A JSON column's path list taken
  from the 1,000-row sample after the whole-table query failed is no longer cached as complete. Inspect SQL shows the
  expanded times but "Copy" copies the macro form ("Edit as SQL" also uses it), with "Copy as shown" for the expanded text.
  The filter editor's value lookup forgets the text typed for a previous field or operator.

---

## [0.78.0] — 2026-11-22

### Added
- **Rare values in value autocomplete.** After 2+ characters of a value in the KQL bar or the filter editor's value box, Observe also looks the prefix up over the whole time range (budgeted to 2 s and 20M rows read). Matches come first with their full-range counts, then the sampled values.
- **Scan full range** in the field popover (Top values and Distribution) and on the Field statistics tab. It reruns the statistics over every matching document instead of the 5,000 newest (budgeted to 10 s and 20M rows read). The caption says whether the scan was complete, partial (hit the row-read limit, with the estimated total), unknown, or cut off by the time limit. Counts are marked approximate when they are estimates.

---

## [0.77.0] — 2026-11-22

### Added
- **Map / JSON field labels (round 5 #7).** Map and JSON columns and their keys / paths show a `Map` or `JSON` badge in the Discover sidebar and the Visualize field list; hovering a field's icon, name or badge shows where it comes from and its ClickHouse type.
- **Typed JSON paths.** Dynamic (undeclared) JSON paths get their type from a small sample, so a numeric path is a number field: Visualize can average / sum / take percentiles of it, the field popover shows its distribution, and top values no longer count rows without the path as an empty value.

### Changed
- **KQL autocomplete drills into a JSON column** like a Map: accepting `Payload` inserts `Payload.` and lists its paths; values of a path are suggested from its typed column.

### Fixed
- **Security:** KQL value suggestions no longer run a lookup with an unknown typed field name spliced into SQL.
- Visualize top values and metrics on a dynamic JSON path failed (`Data types Variant/Dynamic are not allowed in GROUP BY keys`, `Illegal type Dynamic of argument for aggregate function avg`).
- `Payload.x < 100` matched every row without the path (a missing value read as 0); `Payload.name > 1` failed ("Cannot parse string as Float64").
- `Payload.user.id : 1*` failed (ILIKE on a number); `Payload.tags : retry` on an array path failed; `Payload : x` failed parsing `x` as JSON (now matches nothing); `not Payload.x:*` matched nothing.
- Filter pills on JSON paths: ranges compare numerically, "does not exist" counts rows without the path, "contains" works on numeric paths, array paths match any element.
- The document panel no longer shows only an error when the JSON-path lookup of one column failed; the path list falls back to the sample when the whole-table lookup fails (e.g. times out).

---

## [0.76.0] — 2026-11-22

- Discover and Visualize share one query bar component (`src/components/QueryBar.tsx`): data view picker, Schema button, Add filter, query menu, KQL search bar, with page-specific trailing controls. `lens/QueryRow.tsx` is now a thin wrapper.
- Visualize: the "Visualize" title left of the data view picker is removed; the picker moved into the query bar row (same place as Discover).
- New "Schema" button next to the data view picker (Discover and Visualize) opening a modal with the view's columns and ClickHouse types, with a filter box.

---

## [0.75.0] — 2026-11-22

- Visualize is wrapped in `PluginPage` (as Discover is), so the side-menu entry is marked active whenever the page is open.
- An empty Visualize workspace shows the dimension slots (Horizontal axis / Vertical axis / Breakdown) with add buttons.
- Removing the only horizontal axis of a line/area/bar/heatmap keeps the chart type and shows an empty visualization instead of switching to Metric.
- Inspect SQL shows the macro-expanded SQL: Discover expands `$__fromTime`/`$__toTime` with the time range; Visualize's Inspector leads with `executedSql` and keeps the macro form after it.

---

## [0.74.0] — 2026-11-22

- Visualize: the Fields list and the Dimensions panel are resizable with drag handles (Grafana `useSplitter`, the same as Discover's sidebar); widths persist in localStorage (`clickhouse-observe.lens.fieldsSplit`, `clickhouse-observe.lens.dimsSplit`).
- Visualize: the Table chart paginates (`enablePagination`), in the page and in the exported dashboard panel, so a large table no longer hides its bottom / summary row.
- Discover: the breadcrumb no longer repeats the page name (`Discover > Discover`); the `PluginPage` `pageNav` child was removed so the nav entry is the last crumb.

---

## [0.73.0] — 2026-11-22

### Fixed
- **A slow or stuck Discover tab no longer stalls the other tabs or Visualize.** Leaving a tab (switching, closing, opening another page) stops waiting for its queries, which frees Grafana's few concurrent query slots and drops results nobody shows.

---

## [0.72.0] — 2026-11-21

### Added
- **Visualize: Percentile rank** (round 3 #22). Quick function with a `Percentile ranks value` input (any number, decimals allowed, default 0 as in Kibana): the share of a number field's values that are less than or equal to the value, shown as a percent ("77.67%") unless the metric has its own Value format. Label "Percentile rank (9) of SeverityNumber". Also as the inner metric of Differences / Moving average, and in Formula as `percentile_rank(field, value=N)` (0–1). Saved dashboard panels compute the same SQL and show it as a percent.

### Changed
- **Visualize pie / donut labels** (round 3 #18): drawn by the page instead of Grafana's piechart. Labels read like Kibana's ("info 43.93%", up to two decimals), sit inside the slice (the donut's ring) when they fit, otherwise outside with a leader line, and never overlap; the legend shows value and decimal percent; hovering a slice shows a tooltip; one click (or Enter) on a slice filters on its value. Saved dashboard pie panels are unchanged (Grafana's piechart).
- **A fresh Visualize open starts with an empty workspace** (round 3 #19), as Kibana's Lens: the side-menu link no longer brings back the previous chart (the per-tab session draft is gone). A reload, Back, a shared link and Explore in Discover → Back keep the chart, which rides in the URL.
- **Visualize opens faster** (round 3 #8): the chart query starts as soon as the table's columns are known (it no longer waits for the JSON-path lookup unless the chart uses a JSON path), and Visualize skips the text skip-index lookup it never used — one query and two round trips fewer before the chart on a table with a JSON column (perf-50m: 7 → 6 queries). Discover reads the skip indexes alongside the columns instead of after them (one round trip fewer before its first query).

### Fixed
- Search suggestions no longer reopen after Enter (or Clear) when a value lookup was still pending (round 3 #20; the shared search bar, so Discover too).
- Metric tiles by category fit the chart area: rows shrink from 140 px down to 110 px before the grid scrolls (the third row was cut by 8 px; round 3 #23).


### Fixed (coordinator, batch 11)
- Saved pie and donut panels show each slice's value ("payments"), not "Count of records" for every slice (the metric field is no longer renamed for pies, as for metric tiles in 0.69.2).
- A Discover link with a search no longer sends its list and histogram queries twice when field discovery finishes before the first fetch (12 → 10 queries on the fixture).
---

## [0.71.0] — 2026-11-21

- Saved Visualize panels with a date histogram bucket like Visualize's auto interval (about 60 bars) instead of ~1-minute buckets drawn as hairlines.
- Add to dashboard: panel and dashboard titles start empty with placeholders (`Logs`, `Log volume`, `Discover export`) instead of prefilled text. A Logs table capped at 1,000 rows is titled `Logs (newest 1,000)` by default, and its info text states how many documents matched when it was added.
- Cancel in Visualize (edit from a dashboard) also asks `Leave with unsaved changes?` when the dashboard could not be loaded; the baseline is taken from the URL at entry.
- Short links drop `?orgId=1` (`/goto/<uid>`).

---

## [0.70.0] — 2026-11-21

- Discover: a data view with no mapped columns (e.g. no time field) opens with a Summary column (`key: value` of every field) instead of blank rows.
- Discover: data views without a time field show the matching count ("200 of 41,520 loaded", Load all) from one count query.
- Discover: the document panel overlays the grid (Kibana flyout) instead of squeezing it; grid, Message column and pager stay intact.
- Discover: the Message column no longer overlaps an added column at 1440 px (minimum width now on the cell).
- Discover: fewer queries on load with a search: windowed document search is at most 3 steps; empty Map columns are sampled once.
- Histogram tooltip reads "Count of records N".
- Single-document permalink is shorter: the time range travels only inside `ret`. Old links still open.
- Field sidebar default width 24 % (min 240 px) so long names fit.
- A link naming a personal data view missing from this browser shows a warning instead of silently opening another view.

---

## [0.69.2] — 2026-11-21

### Fixed
- Panels saved from Visualize with a top-values breakdown no longer show phantom series on the dashboard (pie / donut slices all named "Count of records", "payments k0 = 0", doubled bar legends "k1 auth", zero metric tiles): the row-kind columns are hidden, Other / (missing) rows are labelled in the query, and metric tiles keep their per-value names ("payments", or "payments · Count of records" with several metrics).

---

## [0.69.1] — 2026-11-21

### Fixed
- Value suggestions no longer narrow to the value already in the query: with `ServiceName: "frontend"` in the search bar (or as a filter), typing a ServiceName value offers every service. Suggestions are scoped to the time range and the filters on other fields.

---

## [0.69.0] — 2026-11-21

### Changed
- Data views without a time field: Visualize hides its time picker and the Time shift / Reduced time range metric options (Discover already hid its time picker and histogram). Choosing "No time field" for a data view shows a short warning that every search reads the whole table.

---

## [0.68.1] — 2026-11-21

### Changed
- The Logs page is now called Discover (menu item, page title, default "Discover export" dashboard name). The URL stays `/logs`, so existing links keep working.

---

## [0.68.0] — 2026-11-21

### Added
- **Four chart types in Visualize (R3-CHARTS):** **Bar horizontal** (its own switcher entry; top values with long labels, largest on top, the category axis sized to the labels with `…` and the full text on hover), **Donut**, **Heat map** (e.g. errors per service over time: rows in rank order, colour legend, a count with no row is 0 (other metrics: empty cell, distinct from 0), tooltip, click-to-filter, keyboard grid) and **Gauge** (arc or horizontal bar, one per Break down by value up to 12, maximum from the Maximum value metric, a typed number or automatic, optional colour bands).
- Each saves to a dashboard as the matching native Grafana panel: barchart (horizontal), piechart (donut), heatmap (time on X; a colour-coded table matrix for categories on X), gauge / bar gauge.
- Suggestions: `Heat map` for a date histogram with a category breakdown, `Bar horizontal` for top values on X, `Gauge` for a Metric with a Maximum value.

### Changed
- A chart switch now also parks the metrics the target can't show (Pie / Donut / Heat map / Gauge show one) and restores them on the way back; a Maximum value metric is parked with its role instead of becoming a plain metric on Bar / Table.
- Bar horizontal's dimension groups read `Vertical axis` (categories) and `Horizontal axis` (metrics).

---

## [0.67.0] — 2026-11-21

### Added
- **Standard deviation and Last value (LENS-CALC-01).** New quick functions: population standard deviation of a number field (as Elasticsearch's `std_deviation`), and the value of the newest document (by the data view's time field) that has the field.
- **Time-series calculations.** A "Calculations" group in the metric editor: Cumulative sum, Differences, Moving average (Window size 1–100, default 5) and Counter rate (per second). Each wraps a metric ("Moving average of Median of duration"; Cumulative sum adds counts or sums) and is calculated per series. They need a date histogram: without one they are disabled with the reason, and a chart that loses its date histogram shows why instead of wrong numbers.
- **Formula functions:** `standard_deviation`, `last_value`, `cumulative_sum`, `differences`, `moving_average(…, window=5)`, `counter_rate`, `overall_sum`, `overall_average`, `overall_min`, `overall_max` — e.g. `count() / overall_sum(count())` for percent of total. The function reference is grouped (Aggregations, Time series, Overall, Math).
- Every quick function has a short explanation (tooltip and a note under the grid).

### Changed
- Empty metric values (a bucket with no values, the first bucket of a difference) are gaps in charts and empty table cells instead of 0; counts stay 0.
- Top values "Rank by → Custom metric" lists only metrics that can rank (not calculations, except Cumulative sum, which ranks by its total).

### Fixed
- Saved dashboard panels with a week / month / year interval and Include empty rows failed with a ClickHouse WITH FILL type error.
- Normalize by unit on a saved panel with a typed minimum interval used the dashboard interval instead of the bucket length.

---

## [0.66.0] — 2026-11-21

### Added
- **Visualize has Discover's query row (R3-QUERYBAR).** Add filter, the query menu (Clear all, load saved query, pin / negate / disable all), and the KQL search bar with autocomplete sit under the toolbar, above the filter pills. Typing changes nothing until Enter; the query goes to the shared `q` URL param (one history entry) and the chart re-runs once. An invalid query shows the error in the bar and in place of the chart.

### Changed
- The read-only query / filter-count summary in the Visualize toolbar is removed (the bar shows the query).

---

## [0.65.0] — 2026-11-20

- Changed: opening or saving a saved search names the Discover tab after it (was "Untitled") and puts its id in the URL (`ss=<id>`). The id is cleared when the query, filters, columns or sort are changed, or the data view switched, and a link carrying only `ss` reopens the saved search in a fresh browser. The Share link keeps `ss`.
- Added: a "Store time range" checkbox in the Save search dialog (default on, as before); a search saved without it leaves the current time range alone when opened.
- Fixed: the delete (trash) button in the Saved searches menu has the accessible name "Delete saved search <title>".
- Changed: new shared saved searches are stored in a Grafana folder "Observe saved searches" (created on first save through the Grafana 12+ folder API); when the user cannot read, create or write it they go to General as before. Existing ones stay where they are and are still listed by tag across folders.

---

## [0.64.0] — 2026-11-20

- Discover grid: the default row is now one line of message with an ellipsis (about 40 px instead of 83 px; "Body cell lines" default 3 -> 1). A saved Display options choice still wins. The histogram is 104 px tall (was 128) with a tighter header, so more rows fit above the fold.
- Discover pager: shows the number of matching documents (the histogram's count, no extra query): "200 of 1,207 loaded", and the document panel reads "1 of 1,207". Paging past the loaded rows fetches at least 200 rows per request (was exactly the missing page, 50). A "Load all N" button appears when at most 5,000 documents match. Raw SQL and views without a time field keep "200 rows loaded+".

---

## [0.63.0] — 2026-11-20

- Filter builder: one pill can now hold several conditions combined with OR and AND, with nesting (AND of ORs, OR of ANDs, up to three levels like Kibana). Each condition row has "Add OR condition" / "Add AND condition" and a delete button; the Preview line shows the combined filter (for example `ServiceName = payments OR (ServiceName = auth AND SeverityNumber = 17)`).
- Compound pills negate, disable, pin, edit and delete as a whole, appear in the URL and saved searches, and read as one pill (`NOT (...)` when excluded). Single-condition pills and existing links are unchanged.

---

## [0.62.0] — 2026-11-20

- Visualize opened from a dashboard panel: "Save and return" is now one click (no confirm dialog); the panel keeps its title and description. A concurrent dashboard change is still reported (the dialog opens with the reason) and nothing is overwritten.
- "Cancel" asks "Leave with unsaved changes? / Discard changes" only when the chart differs from the panel it was opened from; no prompt when nothing changed.
- Visualize "Explore in Discover" opens in the same tab (browser Back returns to the chart); Ctrl/middle-click still opens a new tab.
- Share dialog short-link hint: "anyone who can open this Grafana can use it" (links work anonymously when anonymous access is on).

---

## [0.61.0] — 2026-11-20

- Visualize: the dimension editor's footer (Remove dimension / Close) is pinned to the bottom of the side panel, so it stays visible when the editor (for example Top values) is taller than the viewport; only the body scrolls.
- Visualize pie: when a slice is under 5% of the total the on-slice labels are dropped (they overlapped, "warn 8%" over "debug 6%") and the legend shows value and percent for every slice.
- Visualize time axis: the last tick label is no longer clipped at the right edge (a tick whose label would not fit is dropped, so an 8 h range ends on 13:00), and Line / Area no longer slope down to 0 over an empty partial edge bucket.

---

## [0.60.0] — 2026-11-20

- Fix: the ClickHouse dev healthcheck never passed (compose interpolated `$rc` away), so the MEMORY_LIMIT_EXCEEDED self-restart could not run; `$$rc` now (finding 1).
- Fix: Discover → Add to dashboard table panel no longer shows "COUNT 200" for 1,207 matches: it holds the newest 1,000 documents, pages, and says so in its description (finding 3).
- Fix: the dashboard Log volume panel uses about 60 buckets like Discover (`maxDataPoints: 60`), not one per pixel of panel width (finding 10).

- Fix: after an invalid search, Discover's histogram no longer keeps the previous search's bars and row count; it says "No chart: the search has an error", as Kibana clears its chart (finding 2).
- Fix: the Discover histogram tooltip shows exact counts with separators ("Total: 1,920"), not "1.92 K" (finding 6).
- Fix: the Field statistics tab says "Calculated from 2,161 records" when every matching document was used; "sample" only when the 5,000-row cap is reached (finding 20).
- Fix: the document JSON view shows every DateTime column as ISO 8601, including the partition column `TimestampTime` (finding 18; the single-document link length is unchanged).
- Discover histogram: Millisecond interval (Kibana has it); scaled through 2/5/10/…/500 ms and then seconds with the usual notice when it would exceed 1,000 bars; buckets use `toDateTime64(ts, 3)`; maps to Visualize's `1ms` both ways (finding 21).
- Fix: a `bd` link parameter that can't be applied (junk, or a field this data view lacks) shows a dismissible notice above the histogram instead of being dropped silently (finding 17 / round-1 #45).

---

## [0.59.0] — 2026-11-20

- Fixed: opening Discover with a query (`q=`) or filters in the URL no longer runs the document list and the histogram twice. The re-run after field discovery now happens only when the SQL built with the discovered fields differs from the SQL that already ran (a Map key or JSON path unknown at first); a config-column search such as `SeverityText : error` compiles the same and is not repeated or cancelled.

---

## [0.58.0] — 2026-11-20

- Faster field discovery on big tables: the Map-key sample now reads the latest hour of the range first (cost no longer grows with table size or range), and only widens to the full range, then 7 days, when a window has too few rows to hold any keys.
- A Map column that is simply empty in the range (e.g. ScopeAttributes) is no longer sampled a second time on every load.

---

## [0.57.0] — 2026-11-20

### Changed
- **Faster document list on long ranges (PERF-SEARCH).** With the default newest-first sort the list searches the most recent hour first and widens (6 h, 36 h, full range) only until the page is full, so a selective filter over 7+ days no longer scans the whole range before showing rows. Same rows, order and paging; the histogram and total still cover the whole range. Other sorts are unchanged.
- **Indexed wildcard search.** If the message column has an `ngrambf_v1` index on `lower(Body)`, `*term*` searches use it (`lower(Body) LIKE '%term%'`). Setup and DDL in `docs/data-view-setup.md`. Without the index nothing changes.

---

## [0.56.0] — 2026-11-20

### Changed
- **Dev ClickHouse no longer locks itself out (#1).** Server cap 2 GiB to 3.5 GiB, container limit 3 GiB to 4 GiB, `restart: unless-stopped`, jemalloc returns freed pages after 1 s, and the healthcheck restarts the container when the server answers MEMORY_LIMIT_EXCEEDED.
- **Chart-type switches reuse the last result (#5).** Bar to Line to Area no longer re-runs identical SQL: the rows of the last 8 distinct queries are kept for 60 s (keyed by datasource, compiled SQL and time range). A new Refresh button next to the time picker always re-runs.
- **Surrounding documents search a narrow window first (#6).** Neighbours are looked up within 1 min of the anchor and the window widens (1 h, 1 d, 30 d, unbounded) only while fewer rows than requested come back, so large tables read a few granules instead of every part.
- **Discover histogram value axis uses the Visualize number format (#9).** `1,000`, `25,000`, `50M`, `1.5B` instead of `1 Mil`.

---

## [0.55.0] — 2026-11-20

### Fixed
- **Faster page load.** Discover and Visualize no longer repeat schema queries: `system.columns`, JSON-path discovery and Map-key samples run once per table and are shared by every part of the page (cached for the session, cleared by the field list's refresh). The default view's schema is not read when the link names another view. The Map-key samples that fill the field list read only the current time range (widened to 7 days only when nothing is found) instead of the whole table.
- The trace-link probe (`SELECT '' AS traceID`) now runs only when a trace link is first needed (opening a document with a trace id), not on every page load.

---

## [0.54.0] — 2026-11-20

### Added
- **Shared saved searches (comparison #5).** "Save current" now stores the search as a panel-less Grafana dashboard tagged `observe-saved-search`, so every user who can see dashboards sees it in the Saved searches menu (like Kibana saved objects). Browser-only searches stay listed (marked "(this browser)"); if the viewer cannot create dashboards the search is saved in the browser and the menu says so.
- **Description and tags** in the save dialog; the description shows as the item's tooltip, tags as #tags.
- **Copy column** in the column header menu: copies every loaded value of the column, one per line.

### Fixed
- **Explore in Discover from Visualize keeps the chart's breakdown** (`bd=field:col:<expr>`) when the chart's top-values field is a known column (#38).

---

## [0.53.0] — 2026-11-20

- Pie: distinct stable colour per slice (as in XY), "name NN%" labels, grouped legend values.
- Metric: a single tile is centred at a Kibana-like size; per-value tiles in a 3-column grid with the metric name as subtitle.
- Table: thousands separators and wrapped headers.
- Top values: "Group remaining values as Other" on by default for new breakdowns.
- Dimension editor no longer clips at 1440 px.
- Dashboard export: XY series keep their Visualize colours.
- Inspector: SQL shown as text, "Result rows" instead of "Hits", ClickHouse stats only when present, metric value format in the Data view.

---

## [0.52.0] — 2026-11-20

### Added

- **Map keys as fields (Kibana parity).** Keys of `ResourceAttributes`, `LogAttributes`, `ScopeAttributes` (and any Map column) are ordinary fields (`ResourceAttributes.host.name`) in the field sidebar, the Add filter field picker and the Field statistics tab; capped at 100 keys per column.
- **Empty results help.** "No results match your search criteria" with tips and a "Search entire time range" button; the empty histogram is hidden.
- **Filter groups and bulk menu.** Pills can be grouped with OR (or AND); a ⋮ menu next to the pills offers Enable all, Disable all, Pin / Unpin all, Invert inclusion and Remove all.
- **Unknown field warning.** `nosuchfield : x` warns that the field is not in the data view.

### Changed

- **After a failed or invalid query the previous rows are no longer shown**; the error replaces them.
- **Field statistics:** empty strings count as "(blank)" values; time fields show an earliest / latest range.

---

## [0.51.0] — 2026-11-19

### Added

- **Visualize XY tooltip (Kibana parity).** Hovering a Bar / Line / Area chart shows a crosshair and a tooltip with every series at that X (time header `Jan 5, 2026 @ 09:00`, colour, name, value with thousands separators), the series under the pointer highlighted; focusing a bar or point with the keyboard shows it too.
- **Legend colour picker.** The legend ⋮ menu has a colour palette and `Reset color`; the choice is kept in the chart state (URL, draft, saved chart) and does not re-run the query.

### Changed

- **Stable series colours.** A breakdown value keeps its colour across chart types and click-filters (colour by value, not by position).
- **Legend and stack order** follow the Top values rank (count descending by default), with Other / (missing) last.
- **Value axis** ends on a nice tick (a 140 peak → 0–140 by 20 instead of 0–200) and count axes never show fractional ticks.
- **Time axis** ticks fall on round times with the date under the first tick; no automatic "Timestamp" axis title; partial first / last buckets are shaded.
- **Lines** are drawn without a dot on every point (dots on hover, focus or isolated points).
- **Numbers** in the XY chart use thousands separators (`9,264` instead of `9.3K`); axes abbreviate only from a million.
- **Line has no sub-type** (Kibana Line never stacks): the Stacked / Percentage / Unstacked control is hidden for Line, which always draws unstacked; old links with line + stacked still load.
- **Chart type switch** keeps the previous chart on screen until the new one is ready (no blank frame).

### Fixed

- Brushing a time range now also works when the drag starts on a bar; a click without movement still opens the filter chooser.
- Line charts with a Percentage sub-type kept from Bar / Area no longer draw percentages (chart, `panelSpec` and dashboard export).

---

## [0.50.0] — 2026-11-19

### Added
- **Save and return (Visualize).** Edit in Visualize from a dashboard panel now opens Visualize with `Cancel` (back to the dashboard unchanged), `Save as new` and `Save and return`. Save and return keeps the panel's title and description in the dialog, replaces that panel in place (same id, position and size) and returns to the dashboard on the time range it had. If someone saved the dashboard in between, the save is refused with a clear message instead of overwriting their change.
- **Open in Discover.** Logs panels added from Discover have `Extensions → Open in Discover` in the panel menu: Discover reopens with the panel's query, filters, columns, data view and the dashboard's time range.
- **Share in Visualize.** A `Share` button in the Visualize toolbar opens the same dialog as Discover's (absolute / relative time, Copy link).
- **Short links.** Copy link in Discover and Visualize copies a Grafana short link (`/goto/…`), with a `Short link` switch; the full link is used if shortening fails.
- **Add to dashboard: panel titles.** The Discover dialog lets you title the logs table and the volume histogram.

### Changed
- **Discover → Add to dashboard opens on Discover's time range** (it used to open on "Last 1 hour", so both panels showed No data). An existing dashboard keeps its own range.
- **The exported logs table shows Discover's columns** in Discover's order and names (Time, Level, Service, Message, …), with the message wrapping and a row count in the footer, instead of every raw column.
- **Duplicate dashboard titles** are flagged in the Add to dashboard dialog while typing, and Grafana's name conflict (and other save errors) are explained in the dialogs instead of a raw error.
- **Legends of saved charts** show the breakdown value (`payments`) instead of `m0 payments`, and the volume panel shows `error` instead of `count error`.
- **Saved time-series count charts no longer draw lines across empty buckets**: empty buckets are 0, as in Visualize with Include empty rows.
- **The `Saved` button is now `Saved searches`** (secondary, folder icon, caret) and has no tooltip covering the menu's `Save current`.

### Fixed
- Add to dashboard checkbox labels were centred away from their boxes.
- `$` in a search value inside Discover's exported panels could be interpolated by Grafana as a dashboard variable.

---

## [0.49.0] — 2026-11-19

### Added
- **Column resize (PARITY-GRID).** Drag a column header's right edge (or focus the handle and use ←/→; double-click resets). Widths are kept with the columns in the URL and saved searches and never re-run the query. Dragging the header body still reorders.
- **Column header menu.** Clicking a header name opens a menu like Kibana's: Sort ascending, Sort descending, Move left, Move right, Reset width, Copy name, Remove column (the small ‹ › × icons are gone).
- **View single document.** The document panel links to `doc/<dataViewId>/<docId>`, a permalink page showing that one document (same identity as surrounding documents); filtering from it returns to Discover with the filter.
- **Add filter on Surrounding documents.**

### Changed
- **Document panel navigation covers every loaded row** (`51 of 200`, not `1 of 50`), fetching more when stepping past the last loaded row; the grid follows to the document's page. ←/→ step between documents, Escape closes the panel, focus moves into the panel and back to the row. "First / Last log on this page" are now "First log" / "Last log".
- **Wider document panel** (55 % by default, at least 400 px, still resizable); field names wrap at the dots; the panel toolbar wraps so the search box is never cut; JSON shows the time as ISO 8601.
- **Field popover:** filter for / out buttons are always visible on every value, with a bar gauge; "sample records" only when the 5,000-row sample is full; Map keys can be added as a column in one click from the key list; the drilled key's back link sits inside the popover and long names wrap.
- **Surrounding documents:** the anchor row stays highlighted on any zebra stripe; dense rows with page scroll; the anchor stays in view after Load newer; the detail panel is sticky and resizable.

### Fixed
- Adding columns no longer collapses the field list to one-letter names or clips the grid and pager on the right; the grid scrolls sideways inside its own area and the message column keeps a readable width.
- Sorting by a column keeps time order (newest first) among equal values.
- The Body field can no longer be added as a second column while the Message column shows Body (its field-list entry says so).
- The cell action bar on the first row no longer covers the column header.

---

## [0.48.0] — 2026-11-19

### Changed
- **Discover auto-refresh is off by default** (Kibana: paused). It used to start at 30 s, re-running the search every 30 seconds even on an absolute past window. A chosen interval is kept in the URL (`refresh=1m`) and restored from links.
- **Histogram starts with "No breakdown"** (Kibana's default; it used to break down by severity). `bd=severity` or a field breakdown in the URL still applies.
- **Finer auto histogram intervals:** 7 days now buckets at 3 hours (56 bars, as Kibana) instead of 6 hours; 15-minute and 12-hour steps added. Visualize's automatic date histogram uses the same steps, so it changes the same way.
- **Too-fine intervals are scaled, not disabled:** Second / Minute / Hour / Day are always selectable. When an interval would make more than 1,000 bars it is scaled to the finest round interval that fits, and the caption shows `(interval: Minute, scaled to 15 minutes)` with a `⚠ Scaled to 15 minutes` notice (Kibana: "scaled to 10 minutes").
- **Histogram axis:** ticks on round times (every 30 minutes, every hour, midnight …) spaced so labels never collide; 7-day ranges read `1st … 7th` with `January 2026` (Kibana), sub-day ranges `HH:mm` with the date under the first tick and each new day, multi-month ranges `Jan 2026`.
- **Partial buckets** (only partly inside the time range) are drawn faded on a grey band, with a tooltip note.

### Fixed
- **Histogram brush snapped inward to whole buckets** (a 4.8 h → 14.4 h drag became 06:00 → 12:00) and a drag inside one bucket gave `from == to` and an empty result. The brush now uses the exact dragged times (whole seconds, at least one second or one pixel wide) and the new range is re-bucketed. A click zooms to the clicked bucket (start → end) instead of a half-bucket window around its start.
- **Row count one short of every other count** (2,160 vs Kibana's and the field popover's 2,161 for 08:00–12:00): the histogram dropped the bucket starting exactly at the range end, which holds rows at `to` (the range includes its end).
- **The histogram's two-line first axis label overlapped the `N rows (count)` caption** (document panel open, or 0 rows): the axis row grows to two lines when needed.
- **A malformed `bd` URL parameter was ignored silently while the URL kept it:** `bd=field:ServiceName` (no `col:` prefix) now resolves to the column and the URL is rewritten to `field:col:ServiceName`; an unknown field or junk value is dropped from the URL.

---

## [0.47.0] — 2026-11-19

### Added
- **Edit in Visualize from a dashboard panel** (LENS-SAVE-02; spec 20-lens.md). Panels added to a dashboard from Visualize get `Extensions → Edit in Visualize` in their panel menu (Kibana's "Edit visualization in Lens"): it reopens the chart in Visualize with its dimensions, query, filters and data view, and the dashboard's time range. The panel stays a normal Grafana panel. Other panels don't show the item. Requires a Grafana restart (plugin.json declares the new link).
- **Default time range setting** (spec 30-shared.md SHARED-STATE-02; Kibana's `timepicker:timeDefaults`). App config → `Default time range` (From / To, time expressions or absolute dates): the range Discover and Visualize open on when a link carries none. Dev provisioning opens on the fixture window (2026-01-01 → 2026-01-08 UTC).

### Changed
- Visualize no longer repeats the data view's table next to the data view picker; the table is in the picker's tooltip. The carried query / filter summary shows only when there is one.

### Fixed
- **Visualize: switching to Metric (or Pie) lost the date histogram and there was no way back** (LENS-TYPE-01). The dimensions a chart can't show (a date histogram on Metric / Pie, an XY chart's Style and layers) are now parked and come back when switching to a chart that can show them. Dropping a time field on Metric / Pie returns to the time chart; it used to be silently dropped again.
- Visualize: a time field dropped on a bucket slot (Horizontal axis, Break down by, Rows) makes a date histogram instead of top values of timestamps.

---

## [0.46.0] — 2026-11-19

### Added
- **Keyboard and screen-reader support** (#33, SHARED-A11Y-01; spec 30-shared.md "Keyboard and accessibility").
  - **Popovers are dialogs:** the field popover, Add filter, Edit filter, histogram bucket actions, histogram legend actions, cell Expand, Breakdown picker, Display options, field type filter and the Visualize dimension editor are announced as dialogs with "You are in a dialog. Press Escape, or click outside the dialog, to close." Escape closes them (also when they were opened by mouse and focus is still on the page), focus moves in when they open and goes back to the opener when they close.
  - **Menus:** the filter pill menu and the Visualize legend ⋮ menu are real menus: focus starts on the first item, ↑ / ↓ / Home / End move, Escape or Tab closes and returns to the pill or ⋮ button.
  - **Field buttons:** Discover field rows have a `Preview log.level: string` button that opens the field popover from the keyboard; the row's actions (`Add log.level as column`, exists / missing) show while the row has keyboard focus. Visualize keeps `Add log.level to workspace`.
  - **Keyboard drag and drop on Visualize:** each field has a `Drag <field>` handle. Space or Enter lifts the field, the arrow keys move between the drop targets that accept it (the workspace and each dimension group's slot, highlighted), Space or Enter drops it, Escape cancels. Every step is spoken through a live region ("Lifted ServiceName. 3 drop targets. Over the workspace…", "Dropped ServiceName on Breakdown.").
  - **Results grid:** the keyboard cell is exposed through `aria-activedescendant`; column headers sort with a button (and carry `aria-sort`); column actions are named per column (`Move ServiceName left`, `Remove column ServiceName`) and show on keyboard focus.
  - The hit count under the histogram is a status region (the new count is spoken after each search); the KQL bar, SQL editor, rows-per-page, document-detail search and data view search have accessible names.

### Fixed
- Visualize: the Style toolbar button used an icon name that no longer exists in @grafana/ui 13 (`paint-brush` → `palette`), and the Intervals granularity slider lacked the now-required `inputId`; both broke `npm run typecheck` on batch-4.

---

## [0.45.0] — 2026-11-19

### Added
- **Layers on Visualize** (#28, LENS-LAYER-01; spec 20-lens.md "Layers"). XY charts (bar, line, area) get `+ Add layer` below the dimensions → `Select layer type`: Reference lines, Annotations (time charts only), Visualization (shown, not available yet). Each layer is a card with ⋮ layer actions Duplicate layer, Clear layer, Remove layer; its items open an editor that replaces the panel (`← Back`), like Style.
  - **Reference lines:** Static value (a new line starts at the data's highest value) or Computed (Count, Average, Sum, Minimum, Maximum, Median, Unique count of a field, over the chart's query, filters and time range); Label, Color, Axis side Left / Right, Line style Solid / Dashed / Dotted, Fill None / Above / Below. A line beyond the data widens the axis so it stays visible.
  - **Annotations:** Static date (a point in time or a range with an End date) or Query (KQL; marks the newest 100 matching documents in the time range, ignoring the chart's query and filters as in Kibana's default); Label, Color. Drawn as dashed vertical markers (ranges as shaded bands) with a hover title.
  - Layers live in the chart (`lens` URL param, draft), survive switches between bar / line / area, and carry over to exported dashboard panels as Grafana thresholds (static left-axis reference lines).

### Changed
- The Style toolbar button uses the `palette` icon and the Intervals granularity slider has an `inputId` (fixes two typecheck errors on the base, same change as in `feat/shared-a11y-01`).

---

## [0.44.0] — 2026-11-18

### Added
- **Style and Legend panels on Visualize** (#27, LENS-STYLE-01; spec 20-lens.md "Style and Legend panels"). XY charts (bar, line, area) get `Style` and `Legend` toolbar buttons above the dimension panel; each swaps the panel for a settings view with `← Back`.
  - **Style → Appearance:** Bar orientation Vertical / Horizontal (horizontal bars put the categories on the left and the values along the bottom).
  - **Style → Titles and text:** Bar values Hide / Show, if able (a value is drawn on a bar segment only when it fits).
  - **Style → Left / Bottom / Right axis:** Axis title None / Auto / Custom (Auto = the metric names on the value axis, the bucket on the category axis), Gridlines, Tick labels, label Orientation Horizontal / Vertical / Angled; on value axes Axis scale Linear / Logarithmic / Square root, Bounds Full / Data / Custom (lower / upper, validated; Data is off for bar charts, as in Kibana) and Round to nice values. The right axis section appears when a metric is on the right axis (LENS-DIM-02).
  - **Legend:** Visibility Auto / Show / Hide (Auto hides a single series without a breakdown, as in Kibana), Position Outside / Inside, Alignment (outside: Right / Left / Top / Bottom; inside: a corner of the plot), Layout List / Grid.
  - Settings live in the chart (`lens` URL param, saved chart, draft) and carry over to exported dashboard panels where Grafana has an equivalent (legend show / placement, axis label, gridlines, log scale, min / max, soft min 0 for Full bounds, bar orientation, value labels, x tick rotation).

### Changed
- XY charts show automatic axis titles, and the legend is hidden for a single series without a breakdown (Kibana's defaults). Every other default draws as before (legend below the chart as a list).

---

## [0.43.0] — 2026-11-18

### Added
- **Table: Split metrics by** (LENS-CHART-01; spec 20-lens.md "Table: groups Rows / Split metrics by / Metrics"). A Table now has three groups. Buckets in *Split metrics by* turn their values into metric columns (`error › Count of records`, one column per value × metric, in first-seen order, capped at 100 value combinations); *Rows* keep one row per value combination. A row without a combination shows an empty cell, not 0. Moving a bucket between the two needs no new query.
- **Table: Summary row** per metric column (None, Sum, Average, Value count, Minimum, Maximum — Grafana table footer reducers) and **Color by value** (None / Cell / Text, continuous green-yellow-red scale), in the metric editor when the chart is a Table. Both apply to every pivot column of that metric and carry over to the exported dashboard panel.
- **Metric chart tiles**: a grid of tiles (one per *Break down by* value, or one tile) with the label top-left and the big value bottom-right in the metric's Value format; a tile without a value shows a dash. The *Secondary metric* is shown under the label, and the new **Maximum value** group draws a progress bar (primary ÷ maximum, capped at 100 %). The primary metric's series colour colours the value and the bar.
- Table and Metric options are kept in the URL / saved chart (`pivot` on buckets; `summary`, `colorBy`, `role: "max"` on metrics). Unknown or ill-typed values from a link are dropped.

### Changed
- The Metric chart renders its own tiles instead of Grafana's Stat panel (`data-panel="tiles"`). Exported dashboard panels still use Stat.
- Switching chart type drops Table pivots and the Metric chart's Maximum value role (they become ordinary rows / metrics); a Metric chart left with only a maximum gets a Count of records as its primary metric.

---

## [0.42.0] — 2026-11-18

### Added
- **Share this Discover session** (DISC-SESSION-01). A `Share` button in the Discover toolbar opens a modal with a `Use absolute time range` toggle (off keeps a relative range such as "Last 15 minutes", so the link shows the latest data when opened; on pins the exact range shown, as epoch ms; disabled when the range is already absolute), a `You have unsaved changes` warning when no saved search of the view matches the current query, filters, columns and sort, and `Copy link`. The link carries only the URL codec's parameters (`q`, `filters`, `cols`, `sort`, `from`, `to`, `ds`, `interval`, `bd`).
- **⋮ overflow menu in Discover**: `New session` (Discover on the current data view with no query, filters or column changes; pinned filters still apply), `Export tab results (CSV)` (the current search, up to 10,000 documents, the grid's columns in order, UTF-8 with BOM; disabled in raw-SQL mode), `Inspect` (the diagnostics drawer) and `Create alert rule` (opens Grafana's new alert rule form, prefilled: query A counts the documents matching the current search, query, filters and time field included, over a window equal to the current time range clamped to 1 min–7 days; B is a threshold `A > 0` and the condition. Needs `alert.rules:create` or Editor; disabled for views without a time field and in raw-SQL mode).

### Security
- CSV cells are formula-injection safe: a value starting with `=`, `+`, `-`, `@`, tab or carriage return is prefixed with `'` before RFC 4180 quoting.
- The alert query reuses Discover's escaped WHERE clause; `$` inside string literals is written as `\x24` so the ClickHouse datasource's `$__` macros can't be injected through a search value.


### Fixed
- **Export tab results (CSV) saved the file under a random name** (same cause as the Inspector download; same helper).
---

## [0.41.0] — 2026-11-18

### Added
- **Discover session tabs** (#31 DISC-NAV-01; spec 10-discover.md "Discover tabs"). A tab strip above the Discover toolbar keeps several explorations open in one browser tab, each with its own query, filters, columns, sort, time, data view, interval and breakdown. `+` opens a tab on the current data view; each tab has a ⋮ menu (Rename, Duplicate, Move left / right, Close) and a close button; double-click renames; tabs drag-reorder. The ⌄ menu lists Opened tabs and Recently closed tabs (with "17 seconds ago"-style times; click to restore) and Clear recently closed. The active tab is in the URL (`_tab`), so reload and back / forward land on it. Up to 20 tabs, 10 recently closed.
- Grafana's side-menu Discover entry (a URL with no state) reopens the active tab instead of an empty search. A link with Discover state but no `_tab` (shared link, Explore in Discover, trace deep link) loads into the active tab; a link with another session's `_tab` opens as a new tab.


### Fixed
- **Rename from a tab's ⋮ menu closed immediately.** The menu returned focus to its button on close, which blurred (and committed) the new name field; the editor now opens after the menu has closed and focuses a frame later.
- **Cell Expand popover could be covered or clipped** (pre-existing, exposed by the shorter grid under the tab strip): it was drawn inside the grid, so opening past the grid's edge put it under the histogram or outside the window. It is now portalled with fixed positioning, below the cell when there is room (else above), clamped inside the window and following the cell on scroll.
---

## [0.40.0] — 2026-11-18

### Added
- **Inspector on Visualize** (#29, LENS-INSPECT-01; spec 20-lens.md "Inspector"). An `Inspect` button in the Visualize toolbar opens a right drawer with `View: Data | Requests`.
  - **Data:** the chart's table (bucket columns then one column per metric), sortable headers (ascending → descending → off, `aria-sort`), 20 rows per page, ⊕ / ⊖ on top-values cells through the shared action registry (same names and pills as everywhere else; the synthetic "Other" / "(missing)" buckets and date buckets have none), and `Download CSV ⌄` Formatted (as shown: local date-times, grouped numbers) or Raw (as returned).
  - **Requests:** "1 request was made", the latest chart query from the diagnostics tracer (the same spans as Discover's Diagnostics drawer) with duration and ClickHouse query id; tabs Statistics (Hits, Rows read, Bytes read, Data view, Data view ID, Table, Query time, Query time (ClickHouse), Memory usage, Request timestamp, Status — server numbers appear once `system.query_log` enrichment lands), Request (the SQL, plus the post-macro SQL when it differs) and Response (columns + first 100 rows), each with Copy.

### Security
- CSV export never writes a log value a spreadsheet would run as a formula: text starting with `= + - @`, tab or CR is prefixed with `'` (CSV injection); fields are RFC 4180-quoted. File names are reduced to `[A-Za-z0-9_.-]`.


### Fixed
- **Inspector Download CSV saved the file under a random name.** Grafana routes bubbling `<a>` clicks through its router, so the blob link was navigated to, not downloaded. Downloads now go through one helper (`src/utils/download.ts`) that dispatches a non-bubbling click (shared with Discover's CSV export).
---

## [0.39.0] — 2026-11-18

### Added
- **Query menu** (#30, DISC-SEARCH-03; spec 10-discover.md "Query menu"). A ⋮ button left of the Discover query input:
  - **Apply to all** — Enable all, Disable all, Pin all, Unpin all, Invert inclusion (only the items that change something are listed). Pin / unpin / invert update the pinned store (D7) like the pill menu does.
  - **Clear all** — clears the query and every filter on this page (stored pins are kept, same as the pill bar's Clear all).
  - **Load query** — saved queries for the active data view (plus view-less ones), by name, with their description.
  - **Save query** — name (unique per view, case-insensitive: "Name conflicts with an existing saved query"), description, **Include filters**, **Include time filter**. After a load the menu offers **Save changes to "…"** and **Save as new query**.
  - **Manage saved queries** — list with delete.
  - **Language** — KQL (checked); Lucene listed as not supported.
- Saved queries are lighter than saved searches (query + filters + optional time; no columns / sort) and live in localStorage (`poortuna-clickhouse-observe:saved-queries`).

### Security
- Saved queries read back from storage are rebuilt field by field (`sanitizeSavedQuery`): filters through `sanitizeFilterPills`, a time range kept only when both ends are `now…` math or epoch milliseconds, size caps on name / query / description / entry count; the page re-sanitizes filters before applying them.
- **Saved searches** (pre-existing): loading one now also runs its filters through `sanitizeFilterPills` (columns were already rebuilt by `sanitizeColumns`).

---

## [0.38.0] — 2026-11-18

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

---

## [0.37.0] — 2026-11-18

### Added
- **Date histogram interval on the horizontal axis** (#16e, LENS-DIM-05; user request). The date histogram editor has a Field picker (date fields), a `Customize time interval` switch and a `Minimum interval` box: presets Millisecond … Year or a typed `<n><unit>` (`ms s m h d w M y`, e.g. `5m`, `3h`, `2w`, `1M`); invalid text shows an error and is never applied. The interval is a minimum, as in Kibana: past 500 buckets it is scaled up (same unit) and the editor says `Interval scaled to … to stay under 500 buckets`; otherwise it shows `Bucket size: …`. Months and years bucket on calendar boundaries. The interval is in the URL / saved chart; Discover's Edit visualization / Explore in Visualize carry the histogram's interval over, and Explore in Discover carries it back when Discover has the same unit. Saved dashboard panels follow the dashboard resolution but never go below the minimum (`greatest(n, $__interval_s)`), calendar units stay calendar.
- **Date histogram advanced options** (#16e): `Include empty rows` (default on — empty buckets are filled across the whole time picker range, before only between the first and last bucket with data), `Drop partial intervals` (first / last bucket the range only partly covers is dropped from chart and table), `Bind to global time picker` (for a date field other than the view's time field; off = empty rows only between the data's first and last bucket).
- **Intervals and Filters bucket functions** (#16f). Every bucket dimension now has a Functions grid (Date histogram, Intervals, Filters, Top values; a function without a compatible field is disabled, the field is kept when compatible). Intervals (number fields): automatic buckets of a power-of-ten width sized from the data's span with a Granularity slider (coarse ↔ fine) and Include empty rows, or `Create custom ranges` (`from ≤ x < to`, open ends, optional labels, first matching range wins). Filters: one bucket per KQL query with an optional label (empty query = `All records`); a document counts in every bucket it matches; invalid KQL stays in the box with an error and is not applied. Both work on X, as a breakdown, and as Metric / Pie "break down by"; saved panels show their labels.

---

## [0.36.0] — 2026-11-18

### Added
- **Formula metrics on Visualize** (#23, LENS-DIM-03; spec 20-lens.md "Formula editor"). A metric's editor has a `Quick function | Formula` switch; switching converts the quick function (`median(SeverityNumber)`, `percentile(x, percentile=95)`, `count()`). Formulas combine aggregations with `+ - * /`, parentheses and numbers, e.g. the error rate `count(kql='SeverityText : error') / count()`.
- Functions: `count([field], kql=)`, `average`, `sum`, `min`, `max`, `median`, `percentile(field, percentile=95)`, `unique_count` (all with an optional `kql='…'` filter), and math `abs`, `round(x, decimals)`, `floor`, `ceil`, `sqrt`, `exp`, `log(x, base)`, `pow`, `mod`, `clamp`, `pick_max`, `pick_min`, `defaults`. Field names that are not plain identifiers are written in backticks.
- Editor: autocomplete for functions (full signature + description) and fields, auto-closed brackets and quotes, an error list with a `⚠ N errors` badge, function reference (📖), word-wrap and expand toggles. Applied on blur or Ctrl+Enter, only when valid. Division by zero gives an empty value, not ∞.

### Security
- Formulas never reach SQL as text: they are parsed into an AST with a whitelist of functions, operators and named arguments; field references resolve through the metric's field map whose SQL expressions `sanitizeLens` checks against the discovered fields (same rule as a quick function's field), and are emitted with `quoteIdentifier`; numbers are lexer-restricted; `kql=` filters go through the existing KQL compiler (and in saved dashboard panels `$` in them is written as `\x24`, so no macro / variable expansion). Length (1,000 chars), node (200) and depth (32) limits.

---

## [0.35.0] — 2026-11-18

### Added
- **Loading bar** (SHARED-PERF-01): a thin indeterminate bar under the toolbar on Discover (list + histogram queries) and Visualize (field discovery + chart query). Zero-height, so it never shifts the layout; respects reduced motion.
- **Slow query chip with Cancel** on Discover: after 2 s a "Still running · Ns" chip appears; Cancel stops waiting for the list and histogram queries (previous results stay, no error banner) and leaves a dismissible "Query cancelled" notice until the next run.
- **Approximation label on Visualize**: a chart with a Unique count metric says "Unique counts are approximate (ClickHouse uniq)."

### Changed
- The map keys popover caption reads "Discovered from N sample records." (was "N records"), matching the field statistics popover.

---

## [0.34.0] — 2026-11-18

### Added
- **Field statistics tab on Discover** (#22, DISC-FIELDSTATS-01; spec 10-discover.md). A `Documents | Field statistics` switch in the results toolbar. The tab lists every field of the data view, sorted by name: type icon · name · `Documents (%)` (sampled documents with a value) · `Distinct values` · `Distributions` (keyword: bar strip of the top values + `N categories` / `top 10 of N categories`; number: 10-bucket density sparkline with min and max labels; an eye switch hides the column) · Visualize action (same Lens hand-off as the field popover). Rows expand to Documents stats (count, %, distinct), Summary (min / median / max for numbers), Top values (count and %, Filter for / Filter out) and, for numbers, a distribution chart. Name filter; 25 fields per page.
- Stats follow the page's query, filters and time (same 5,000 most-recent-rows sample as the field popover), so the tab and the popover agree.
- New diagnostics op `fieldStats` ("Field statistics").

---

## [0.33.0] — 2026-11-18

### Added
- **Time field on the Configuration page's shared data views** (#16d). Shared views get the same column mapping as Create data view: the table's columns are listed (debounced lookup of the typed datasource / database / table, falls back to typed names when the table can't be listed), a dedicated Timestamp field picker, and every other mapping chosen from the table's columns. The time field stays editable after creation (shared views here, personal views through Edit data view).
- **Converted time fields** (#16d). Besides Date / DateTime columns, the Timestamp field picker lists numeric columns (read as epoch seconds / ms / µs / ns, with an Epoch unit picker; the unit is guessed from one sample value) and text columns (parsed with `parseDateTime64BestEffortOrNull`, no-zone text read as UTC). A converted choice is flagged in the picker (ClickHouse converts every row; no time-index use). Stored as `timestampFormat` on the view (unset = native).
- Every query reads the time field through one function, `timeExpr` (`src/sql/timeExpr.ts`): time filter, histogram, grid sort, detail lookup, surrounding documents, field samples / top values / numeric stats, Map-key sampling and the Lens date histogram. A native column produces byte-identical SQL to before.

### Changed
- On a converted view the raw epoch / text column is an ordinary field: the detail drawer shows it as a number / text, and the grid's Time cell (the converted time) has no filter actions (it can't be compared with the raw column).
- Create data view: the Advanced column mapping no longer repeats the Timestamp field (one picker, with conversion).

### Security
- `buildColumnsQuery` / `buildTablesQuery` now quote the database and table as string literals (`quoteString`); the Configuration page runs them on admin-typed names. The time sample query quotes column and table through `quoteIdentifier` / `tableRef`. `timestampFormat` from stored config is checked against the enum (unknown = native) and never inserted into SQL.

---

## [0.32.0] — 2026-11-18

### Added
- **Data view picker on Visualize** (#16b, LENS-AUTO-01 gap; spec 20-lens.md "Search bar: Data view …"). The same picker as Discover sits in the Visualize toolbar. Switching keeps the query and time; the chart keeps only dimensions on fields the new view has (re-validated with `sanitizeLens` once that view's fields are discovered, and written back to the URL); filters follow D7 — pinned pills are enabled only on the table they were pinned on, other pills arrive disabled on a view of a different table (kept as-is on a view of the same table). The URL now always names the view (`ds`), so Explore in Discover and reloads land on it.
- **Visualize applies the URL's data view** (`ds`), like Discover; it used to chart whatever view was last active.
- **Pinned filters on Visualize** (D7): a Visualize URL without `filters` gets the stored pins, like Discover.
- **"Explore in Visualize" button in the Discover toolbar** (#16c). Same link as the histogram's Edit visualization (Bar over time with the current breakdown), or an empty workspace for a view without a time field; carries query, filters, time (relative stays relative) and data view.
- **Visualize opened without a search context** (Grafana's side-menu entry is a static link) restores the tab's last query, filters, time and data view (session storage `clickhouse-observe.lastSearch`, written by Discover and Visualize), then the view's draft chart.

### Changed
- `useFieldDiscovery` also returns `fieldsFor` (the `discoveryKey` of the table `fields` belong to); Visualize waits until it matches the active view, so a switch never compiles the new table with the previous table's fields.
- The Lens draft is saved only once the view's fields are in (sanitized chart), never mid-switch.


### Fixed
- **Discover link to a different data view lost its query and filters** (pre-existing): opening a link whose `ds` differed from the stored active view was treated as a user view switch, which resets query and filters to the pins. The reset now waits until the link's view is active.
- **Visualize view switch never applied** after the page settled on its entry view (`ds`, filter disabling and chart re-validation were skipped).
---

## [0.31.1] — 2026-11-18

### Security
- **SQL injection through shared links and saved searches** (pre-existing). A Discover URL's `cols` (and a saved search's columns) carried each column's `sqlExpr` and `key`, which `buildLogsQuery` emitted verbatim as `${sqlExpr} AS ${key}`; the URL `sort` column and direction reached `ORDER BY` the same way. A crafted link could run arbitrary SELECTs (e.g. `system.users`) as the datasource user. Restored columns are now rebuilt from trusted sources (`sanitizeColumns`, `src/data/columns.ts`): core columns from the view mapping, discovered fields by id, pinned columns by id, otherwise only a plain column reference (identifier, well-formed Map accessor, dotted path) with a regenerated alias and a checked type. The query builder additionally never emits a non-identifier alias or a non-column-reference expression (`extraColumnSelects`), accepts only an identifier as the sort column (else the default sort) and only `asc`/`desc`. The surrounding-documents page uses the same sanitizer (strict mode).

---

## [0.31.0] — 2026-11-18

### Added
- **Surrounding documents (DISC-DOC-02).** "View surrounding documents" in the document detail panel opens `context/<dataViewId>/<docId>` (breadcrumb `Discover / Surrounding documents`, title `Documents surrounding #<id>`): the anchor document highlighted in pale yellow, 5 newer documents above and 5 older below, `Load [5] newer documents` / `Load [5] older documents` with an editable step (up to 500 per side), and a status line ("7 newer documents · no more newer documents"). The search query is dropped; filters come along disabled (struck through) and can be re-enabled; Discover's columns are kept. Documents sharing a timestamp are ordered by a row id, so paging never skips or repeats one. The page is not bound to the time picker. Rows open the same detail panel, where "View surrounding documents" re-anchors on that document; the breadcrumb returns to Discover with its original query and filters.

---

## [0.30.0] — 2026-11-18

### Added
- **Histogram legend ⋮ menu.** Hovering (or keyboard-focusing) a legend row shows ⋮; it opens a popover titled with the value with `Filter for` / `Filter out` (from the shared action registry). Focus moves into the popover; Escape or a click outside closes it. Shift-click still opens the same popover.
- **Hidden legend series show an eye-slash icon** instead of their colour swatch; legend rows expose `aria-pressed` (shown / hidden) and the legend is a labelled list ("Histogram legend").

### Changed
- **Breakdown picker label reads `Breakdown by <field>`** (`Breakdown by Severity` for the severity breakdown); `No breakdown` until one is chosen. The trigger has `aria-expanded`, the list is a labelled dialog with a labelled search box, the chosen entry has `aria-current`, and Escape closes it and returns focus to the trigger.
- **Ctrl/Cmd+click on a legend entry hides that series** (tooltip wording; behaviour unchanged: a second Ctrl+click shows it again).

### Fixed
- The synthetic `other` series of a field breakdown could be "filtered" from the legend (shift-click) or a bar-segment click, adding a pill for the literal value `other`. It no longer offers filter actions anywhere (right-click bucket actions already excluded it).
- Hidden legend series were kept when the breakdown changed, so a series isolated under one field could hide every series of the next. Changing the breakdown (field or mode) now clears hidden / hovered series and closes the legend menu.

---

## [0.29.0] — 2026-11-18

### Added
- **Top values: Rank by and Rank direction.** Rank by Count of records (default), Alphabetical, or a Custom metric (any metric of the chart); ascending or descending. Needed to answer "least common" and "first alphabetically" questions.
- **Top values: "Group remaining values as Other".** Values outside the top N collapse into one `Other` value so totals stay complete.
- **Top values: "Include documents without this field".** Rows without the field appear as `(missing)` instead of being dropped.
- **Top values: Include values / Exclude values with "Use regular expression".** One value or pattern per line; regex patterns are full-match (`match(expr, '^(?:p)$')`).

### Changed
- **Lens URL/state validation covers the new options.** `decodeLens` rebuilds each top-values bucket from known, well-typed fields only (`cleanTerms`); lists are capped at 50 entries of 200 characters; `sanitizeLens` resets a rank metric that no longer exists.

---

## [0.28.0] — 2026-11-18

### Added
- **Filter builder: greater or equal, less than, is between, is not between.** The spec lists these operators; the builder only had is / is not / one of / exists / contains. New `FilterOp`s `gte`, `lt`, `between`, `not_between` (bounds in `values: [low, high]`, inclusive), with labels, negate pairing (gte <-> lt, between <-> not_between) and pill rendering (`NOT` badge for not-between). `samePill` compares a between pair in order. Bounds are validated in the form (numbers for number fields and Map keys, dates for time fields, From <= To, with a message) and again in SQL: an invalid, missing or empty bound skips the pill (matches nothing; not_between matches everything) instead of sending `BETWEEN '1s' AND '5s'` to ClickHouse. A Map value is read as `toFloat64OrNull(toString(col))` (works for `Map(String, String)` and `Map(String, Float64)`; `'9' < '10'`), and there `lt` / `not_between` are `NOT ifNull(positive, 0)` so rows with a missing or non-numeric key fall on exactly one side of an include / exclude pair.
- **Filter builder: live Preview line** showing the pill text before it is added.

### Changed
- **Filter builder: operator list depends on the field type.** Ranges only for number / time / unknown scalars and Map keys (never a whole Map / JSON / Tuple / Array column); substring match not for number / time (ILIKE needs a string). An edited pill keeps its own operator even if the type would not offer it.
- **Filter builder: Value stays disabled ("Please select operator first...") until an operator is picked.** The operator no longer defaults to "is"; Add filter is enabled only when the draft is complete (field, operator, and the values the operator needs). Matches the spec.
- Editing a pill now keeps its `pinned` flag as well as id / disabled.

---

## [0.27.0] — 2026-11-18

### Added
- **Typed time shorthand next to the time picker** (`-7d`, `-30m`, `now-1h`, `td`, `yd`, `tw`, `tm`, `ty`): Enter or Update applies it; relative ranges stay relative in the URL (`from=now-7d`). Spec DISC-TIME-01 gap (`src/utils/timeShorthand.ts`, `src/components/TimeShorthandInput.tsx`).
- **Duration badge** (`~7d`, `~17h`) beside the picker showing the window length.
- **Pending-time cue**: typed-but-unapplied shorthand shows a green Update button (DISC-TIME-02 dirty state for time).
### Changed
- **URL `from`/`to` also accept ISO-8601 with an explicit zone** (`Z` or `+hh:mm`, as Kibana writes `_g.time`); the plugin still writes epoch ms. Zone-less/date-only/non-ISO strings and invalid `now…` expressions are dropped instead of guessed.
- Shorthand units s/h/d/w/y are case-insensitive (`m` minutes vs `M` months are not); overflowing counts are rejected. The badge uses the larger unit from 2 of it (`~36h`, `~90m`).

---

## [0.26.1] — 2026-11-18

### Security

- **Quoted identifiers escape backslashes.** ClickHouse treats `\` as an escape inside `"quoted"` identifiers, so a field name ending in `\"` (e.g. a filter pill in a shared link) could close the identifier early and append SQL that the viewer then ran. `quoteIdentifier`, dotted paths and table references now escape backslashes before doubling quotes, and the trusted-expression check mirrors ClickHouse's lexer. Found by the security review of PR 19.

---

## [0.26.0] — 2026-11-18

### Added

- **Save a Visualize chart.** Save opens "Save Lens visualization": title (suggested from the chart), description, add to an existing or new dashboard or none, and add to the panel library. The panel runs the same query on the ClickHouse datasource as a core Grafana panel (time series, bar chart, stat, pie, table) and follows the dashboard's time picker. Spec LENS-SAVE-01.
- **Unsaved charts survive a refresh.** The chart is kept in the URL and in this tab's session, so opening Visualize again restores it.

---

## [0.25.0] — 2026-11-18

### Added

- **Visualize a field from Discover.** The field popover's Visualize button opens the Visualize page with the chart for that field, keeping the query, filters, time range and data view. Spec LENS-INTERACT-02 / DISC-SIDEBAR-02.
- **Edit visualization from the histogram.** ✎ in the histogram toolbar opens it on the Visualize page as a bar chart of Count of records over time, split by the current breakdown. Spec DISC-CHART-03.
- **Explore in Discover from a chart.** Opens Discover in a new tab with the same query, filters, time and data view, and the chart's top-values fields as table columns. Spec LENS-INTERACT-02.

### Changed

- **"Edit query in Discover" is now "Explore in Discover"** and also carries the data view and columns.

---

## [0.24.0] — 2026-11-18

### Added

- **Click a chart to filter (Visualize).** One click on a bar or point adds a filter for its value and re-runs; when the segment carries several values (category and breakdown, or a time bucket and breakdown), "Select filters to apply" lists them all ticked, with Cancel / Apply. Spec LENS-INTERACT-01.
- **Legend actions.** Click a legend item to hide or show its series; ⋮ → Filter for / Filter out. Spec LENS-INTERACT-01.
- **Brush to zoom** on time charts sets the time range, as in Discover. Spec LENS-INTERACT-01.
- **Filter bar on the Visualize page.** The same filters as Discover (shared through the URL), editable in place.

### Changed

- **Bar, line and area charts on the Visualize page are drawn by the plugin** (so a single click can filter); Metric, Table and Pie still use Grafana's panels.

---

## [0.23.0] — 2026-11-18

### Added

- **Dimension editor on the Visualize page.** Click a dimension to edit it: pick a quick function (Average, Count, Maximum, Median, Minimum, Percentile, Sum, Unique count) and a compatible field, set the percentile, rename it, or change how many top values to show. Changing the function keeps the field when it still fits; the name follows the function until you type your own. Spec LENS-DIM-02.
- **"+ Add or drag-and-drop a field" slots** in each dimension group now add a dimension and open its editor. Spec LENS-DIM-01.

---

## [0.22.0] — 2026-11-17

### Added

- **One-menu chart type switcher on the Visualize page.** Open "Chart type", optionally type to filter ("Search visualizations"), pick — the chart re-renders with its fields remapped; query, filters and time stay as they are. Arrow keys, Enter and Esc work. Spec LENS-TYPE-01.
- **Stacked / Percentage / Unstacked** control for bar and area charts. Spec LENS-TYPE-01.

### Changed

- **Switching a single-number Metric to Bar** now draws bars over time instead of an empty axis.

---

## [0.21.0] — 2026-11-17

### Added

- **Visualize page (Lens).** Add fields from the list (or drop them on the workspace) and the chart builds itself: Records or a number field → line over time, a keyword → top 9 values as stacked bars, a second keyword → breakdown, a further number → another metric (median by default). Uses the same search, filters and time range as Discover. Specs LENS-START-01, LENS-AUTO-01.
- **Suggestions strip.** Cards under the chart switch to alternatives in one click — a single-number Metric per metric, Area, Bar percentage, Pie, Table and a flip that swaps the axis and breakdown. Spec LENS-SUGG-01.
- **Dimension groups** named per chart (Horizontal axis / Vertical axis / Breakdown, Rows / Metrics, Primary metric / Break down by, Slice by / Size by), each dimension removable. Spec LENS-DIM-01 (display).
- **The visualization is kept in the URL**, so a refresh or a shared link shows the same chart.

---

## [0.20.0] — 2026-11-17

### Added

- **Pin fields in the log detail panel.** Pinned fields stay at the top while you step through logs (per browser tab and table). Spec DISC-DOC-01.
- **"Hide null fields" toggle and a field type filter** in the log detail panel. Spec DISC-DOC-01.
- **First / last log on this page buttons** next to previous / next. Spec DISC-DOC-01.
- **"Filter to rows where X has any value"** on each detail-panel field. Spec DISC-DOC-01.

### Changed

- **The detail panel lists 25 fields per page** (was 50), as in the spec.

---

## [0.19.0] — 2026-11-17

### Added

- **Right-click actions on histogram bars.** A pinned popover shows the bucket time, a checkbox per series with its count, "Filter by time" (zoom to the bucket) and "Filter N selected series" (one "is one of" filter for several series). The hover tooltip says "Right-click to show actions". Spec DISC-CHART-01.
- **Histogram caption with the absolute time range** and the effective interval, e.g. "(interval: Auto - 3 hours)". Spec DISC-CHART-01.

---

## [0.18.0] — 2026-11-17

### Added

- **Field list type filter.** A filter button next to the search lists every field type with its count; the button shows how many types are active. Spec DISC-SIDEBAR-01.
- **Popular fields.** Fields you add as columns or filter on from the list are grouped at the top, most-used first, remembered per browser and table. Spec DISC-SIDEBAR-01.
- **Collapsible field groups with counts.** Selected, Popular and Available fields each collapse and show a count badge. Spec DISC-SIDEBAR-01.

### Changed

- **Field search reads "Search field names"; the row button is named "Add <field> as column" / "Remove <field> column"** for screen readers.

---

## [0.17.0] — 2026-11-17

### Added

- **Results grid keyboard navigation.** Arrow keys move between cells, Home/End jump to row edges, Ctrl+Home/End to the page corners, PgUp/PgDn change page, Enter expands the focused cell and Escape closes it. The focused cell shows its action bar. Spec DISC-TABLE-01.
- **Expand popover on every grid cell.** Shows the full value (JSON pretty-printed) with Filter for, Filter out and Copy value. Opened from the new Expand button on the cell action bar or with Enter. Spec DISC-TABLE-02.
- **Grid display options.** Density (Compact / Normal / Expanded) and body cell lines (1, 2, 3, 5 or Auto), remembered per browser. Spec DISC-TABLE-01.

### Changed

- **"Wrap lines" switch replaced by Display options** (body cell lines "Auto" = wrap). The body cell now shows 3 lines by default (was 2).
- **Enter on the grid expands the focused cell** instead of opening the row detail panel; Shift+Enter (or the row's Open detail button) opens the detail panel.

---

## [0.16.0] — 2026-11-17

### Added

- **Field stats popover: numeric distribution.** Numeric fields get a "Top values | Distribution" toggle; Distribution shows min, median and max and a 10-bucket histogram of the sample. Spec DISC-SIDEBAR-02.
- **Field stats popover: "Break down histogram by this field".** One click in the popover header stacks the histogram by that field (same as picking it in the breakdown menu). Spec DISC-SIDEBAR-02.

### Changed

- **Field stats are computed from the 5,000 most recent matching records** (was 500), with the caption "Calculated from N sample records."; KQL autocomplete still samples 500. An empty result now reads "No field data for the current search".
- **Dev fixture `spec_logs` carries OTel severity numbers** (debug 5, info 9, warn 13, error 17) so numeric statistics can be tested.

---

## [0.15.0] — 2026-11-17

### Added

- **One action registry for value and field actions (`src/actions/registry.ts`).** Filter for / filter out / copy, and field exists / does-not-exist, are defined once and used by the results grid, the log detail drawer, the field stats popover, the field list and the histogram breakdown popover, so wording, icons and behaviour are identical everywhere. Buttons now carry specific accessible names ("Filter for Service: payments") with the short shared tooltip. Spec SHARED-ACTION-01.

### Changed

- **Field list "filter out rows that have this field" creates a "does not exist" pill** instead of an "is empty" pill — the same rows, clearer label, and it works for Map/JSON fields too.

---

## [0.14.0] — 2026-11-17

### Added

- **Pin filters across pages.** The pill menu has "Pin across pages" / "Unpin"; pinned pills show a pin icon and follow you to any page opened without filters, to saved searches and across data views (disabled on a view that reads a different table). Editing or excluding a pinned pill updates the pin and deleting it unpins it; disabling it or "Clear all" only affect the current page. Pin flags inside someone else's link are ignored. Spec DISC-FILTER-01.

---

## [0.13.0] — 2026-11-17

### Added

- **Matched terms are highlighted in result cells.** Terms from the committed KQL query and the enabled positive filters are marked in the grid (bare terms in the message column, `field:value` terms in that field's column; negated, exists and range terms are never marked), so it's visible why a row matched. Spec DISC-SEARCH-02.
- **"Update" cue for an edited query.** While the text in the KQL bar differs from the query the results reflect, the search icon becomes a labelled "Update" button. Spec DISC-SEARCH-02.

---

## [0.12.0] — 2026-11-17

### Added

- **Shared autocomplete service (`src/autocomplete/service.ts`).** Value and Map-key suggestions for every input now come from one place, scoped to the current time range, search and filters; `rankFields` provides context-filtered field suggestions (prefix matches first, type kept for the icon) for the upcoming Visualize field pickers. The Logs page's two duplicated lookup callbacks now use it. Spec SHARED-AUTOCOMPLETE-01.

---

## [0.11.0] — 2026-11-17

### Added

- **Interval and breakdown are part of the shareable URL (`interval`, `bd`).** A shared link now reproduces the histogram bucket size and breakdown, not just search, filters, columns, sort and time. A field breakdown is stored by its stable field id and resolved once field discovery finishes; a field that no longer exists falls back to the view default. Spec SHARED-STATE-02.
- **Pinned filters.** Filter pills can carry `pinned: true`; pinned pills are kept in per-tab session storage, applied to any app page opened without them, and survive switching data views — the same behaviour as Kibana's global filters. (The pin/unpin menu item arrives with DISC-FILTER-01.) Spec SHARED-STATE-01.
- **`buildAppPageUrl` (`src/state/sharedSearch.ts`)** builds a link to another app page carrying the whole search context — the hand-off mechanism the upcoming Visualize page uses.

---

## [0.10.1] — 2026-11-17

### Added

- **Deterministic test fixture, provisioned dev datasource and data views.** `scripts/clickhouse-init/04_spec_fixture.sql` creates `default.spec_logs` (41,520 rows over a fixed 2026-01-01..08 UTC window, no TTL, with a known payments incident), and `provisioning/` now provisions the ClickHouse datasource plus two shared data views. The previous seed data was relative to container start and aged out, so e2e tests could not assert exact counts.
- **Spec-driven development docs.** `docs/spec/` holds the feature spec split per section; `docs/dev/` holds the feature queue, progress log, decisions and test matrix so work can resume across sessions (see `CLAUDE.md`).
- **Page routing.** `App.tsx` now routes `logs` explicitly and redirects unknown paths to it (keeping the query string), so further app pages can be added.

### Fixed

- **e2e suite.** `tests/appConfig.spec.ts` was create-plugin scaffolding that targeted fields this plugin never had; replaced with a real config-page test, plus a logs-page smoke test and page object (`tests/pages/LogsPage.ts`).

---

## [0.10.0] — 2026-09-01

### Added

- **Map sub-key autocomplete in the KQL search bar.** Accepting a Map column suggestion (e.g.
  `LogAttributes`) now inserts `LogAttributes.` and drills into that column's keys instead of
  ending the field — the same bounded, filter-scoped sample query the field sidebar's key popover
  already uses (`sql/keys.ts`), shared via the same cache so browsing a column from either surface
  warms the other. Typing after the dot filters the already-fetched key list locally; no query is
  re-issued per keystroke.

### Changed

- **`<mapColumn>.<key>` in KQL now resolves to `mapColumn['key']`** instead of falling through to a
  free-text `Body` search. Map keys are sample-scoped and are not published as discovered fields the
  way JSON paths are, so a key that was never individually discovered previously missed every field
  lookup and silently degraded to a body ILIKE — a correctly-typed filter could return zero rows
  with no error. This only changes behavior for names whose first dotted segment matches a
  discovered Map column; a real column, Tuple element, JSON path, or explicit `col['key']` bracket
  syntax with the same dotted shape still resolves exactly as before.
- **Map-key and value-suggestion caches now expire** (2-minute TTL) and are cleared by the field
  sidebar's "Refresh field list" button. Previously a cached key/value list for a relative time
  range (e.g. `now-15m`) never refreshed for the rest of the session, since the cache-key bucket for
  a relative range is stable by design.

### Fixed

- **Value suggestions now work for `<mapColumn>.<key>:`.** Typing (or accepting a suggested key for)
  a Map key that was never individually discovered — e.g. `ResourceAttributes.k8s.pod.name:` — used
  to build its value lookup against the literal dotted string instead of the real
  `mapColumn['key']` accessor, since the field-name lookup only ever checked the discovered-fields
  list and a Map key is deliberately never published there. The literal string isn't valid
  ClickHouse syntax, so the query failed and was silently swallowed into an empty dropdown. The
  value-suggestion path now resolves Map keys the same way the KQL-to-SQL translator and the search
  bar's key-drilldown already do.

---

## [0.9.0] — 2026-08-28

### Changed

- **JSON paths are first-class fields again.** Every path inside a native `JSON` column is
  discovered once per table at mount and published as its own field, so it shows up in the field
  sidebar, KQL field autocomplete, value completions, the filter editor and add-as-column — instead
  of hiding behind the on-demand key popover 0.8.0 put it behind. The discovery query is a bare
  `distinctJSONPaths(col)`: ClickHouse 25.12+ answers that from the column's paths metadata
  (object-structure + shared-data path substreams) rather than reading any values, but **only** when
  the query carries no `WHERE`/`PREWHERE`/`GROUP BY` — a time predicate there costs the fast path and
  makes the same query several times slower. It is cached per column for the session and, being
  time- and filter-independent, is not re-run when the dashboard time range changes.
- **Map keys stay on-demand.** A `Map(String, String)` column has no paths metadata — listing its
  keys always scans row data — so it keeps 0.8.0's bounded, filter-scoped sample, paid for only when
  the user opens that column. The key popover is now Map-only.
- **JSON container rows are hidden from the sidebar list.** With every path listed as its own field,
  the container row would only offer top-values over a whole JSON column. It stays in the discovered
  field set, which the log-detail drawer still uses to flatten dotted-path rows.
- **JSON path types come from the column's declared `JSON(...)` paths** (parsed from
  `system.columns`), not from the discovery query: `distinctJSONPathsAndTypes` is not covered by the
  same optimization and would cost a full column scan. Dynamic paths are reported as strings, which
  affects only the sidebar icon and completion hints — generated SQL never depends on it.

### Notes

- On ClickHouse older than 25.12 the path query has no optimized form and falls back to a full JSON
  column read per column on a cold load, bounded by the view's `queryTimeoutSeconds` (default 25s).
- The path list is table-wide, so a path that exists nowhere in the selected time range still
  appears in the sidebar; its top-values popover will come back empty.

---

## [0.8.0] — 2026-08-18

### Changed

- **Field sidebar: on-demand Map/JSON key browsing.** Map/JSON columns now show as a single entry;
  clicking one fires a bounded, filter-scoped query to list that column's keys instead of relying on
  whatever happened to be in the currently-loaded rows, so keys missing from the on-screen sample
  are no longer invisible. Clicking a key opens the existing top-values popover for it.
- **Restored index pruning** on logs/detail/volume queries via an auto-detected coarse
  partition/sort-key predicate, and widened `system.columns` introspection to support it.
- **Deleted the presence query and its Available/Empty field split** — sidebar is a single flat,
  filterable list; presence/empty-state tracking is removed for now.
- **Dropped the eager full-row hydrate fetch** — the detail drawer's full-row fetch is
  click-triggered only again, removing a repeated background query on every auto-refresh tick.
- **Per-view query timeout budget** (`queryTimeoutSeconds`, default 25s) replaces the old
  hardcoded 60s discovery/volume timeouts, which exceeded a typical reverse-proxy's own timeout.

### Fixed

- **Error messages no longer render as `[object Object]`** when a query fails with a plain
  (non-`Error`) rejection, e.g. from a misconfigured or missing datasource.
- Map-key/JSON-path SQL access in attribute grouping now consistently escapes quotes.

---

## [0.7.1] — 2026-08-15

### Fixed

- **Renamed the Timeline tab's phase-breakdown heading** from "Where the time went" to "Time by
  phase".

---

## [0.7.0] — 2026-08-15

### Changed

- **Inspect drawer visual overhaul**: the Timeline tab now has a time ruler with gridlines, a
  phase-breakdown bar (ClickHouse/network/decode/render, colored and legended), and phase-colored
  waterfall bars instead of every bar reading identically. A new
  summary card (name, wall-clock time, duration, query count, rows/bytes read) sits above every
  tab. The activity rail now shows a magnitude micro-bar and relative time per row, a left accent
  border on the selected entry, and distinguishes action roots from background/orphan roots.
  Empty states across all four tabs are now one shared component instead of four bespoke ones.
- **`transport`/`clickhouse`/`decode`/`render` labels are now plain-language** ("decode (parse
  response)", "transport (network round-trip)", etc.) with hover tooltips explaining what each
  phase actually measures. A query span still waiting on (or never receiving) its server-side
  split now shows an explicit reserved-space placeholder explaining why, instead of silently
  showing nothing.
- **The Queries tab collapses long SQL blocks** behind a "Show N more lines" toggle so one query's
  full SETTINGS clause no longer pushes every other query below the fold.
- **The Stats tab gained a `result_rows / read_rows` "Efficiency" column**, tinted when a query
  read far more rows than it returned — the `schema-pk-filter-on-orderby` diagnosis ("filters
  aren't hitting the sort key") made visible without leaving the drawer.
- **The two independently-debounced logs/volume fetches now share one named action** ("Time
  range", "Filters", "Search", "Sort", "Columns") when they're responding to the same user change,
  instead of appearing as two unrelated-looking rail entries.

### Fixed

- **Copy diagnostics bundle leaked unredacted query text** through a span's `error` string (which
  routinely echoes a failing query verbatim), through `system.query_log`'s own `exception` column,
  and through Warnings tab messages built from either — only `sql`/`executedSql` were redacted
  before. Bare (unquoted) database/table identifiers in SQL text are now redacted too, matching
  what the config redaction already stripped.
- **The Warnings & Errors badge was permanently lit by a benign condition**: the logs grid is
  paginated by design, so a full page of results always tripped the "results were capped" finding.
  That check now only fires for ops with no pagination UI of their own (field discovery, presence,
  autocomplete) — a healthy search now shows zero warnings instead of a permanent false positive.
- **Server-side stats enrichment could fire up to ~18 extra `system.query_log` scans per
  auto-refresh tick** — every ended action/root ran its own independent 3-attempt poll cycle. A
  shared, debounced batch poller now covers every root ending together with one query per round,
  and keeps polling a given root only until every one of its queries is matched (previously a fast
  round could match some queries and silently leave others unexplained).
- **A `render` span outliving its action** (the common case — `executeQuery` ends the action once
  logs+volume settle, but `render` closes on the next paint) made the action's own reported
  duration shorter than work it actually caused, and clipped the render bar off the right edge of
  the waterfall. Durations and the waterfall's scale now cover the whole span tree.
- A still-running child span under an already-ended root (the case above) no longer freezes its
  live-updating bar — the waterfall's live tick now checks the whole tree, not just the root.
- `SAMPLE` and `LIMIT` text-level checks could be fooled by a searched value that happened to
  contain those words inside a quoted string (e.g. `Body LIKE '%sample%'`), and a query with a
  subquery could report the subquery's `LIMIT` as the whole query's cap. Both checks now run
  against literal-and-comment-stripped SQL and take the last top-level `LIMIT`.
- A raw-SQL-mode query with a `SETTINGS` clause wrapped across multiple lines could get a second,
  invalid `SETTINGS` clause appended when tagged for enrichment — now detected and skipped.
- `startAutoEnrichment`'s disposer was a no-op after the first call, so an in-flight poll cycle
  could keep mutating spans and re-rendering after `clearRoots()` or a hot reload.
- The drawer's warnings computation ran twice per rail row per render (once for grouping, once per
  row) on every tracer mutation; now computed once per root per version and shared.

---

## [0.6.0] — 2026-08-14

### Added

- **Inspect drawer**: a single diagnostics entry point next to "Inspect SQL" showing, per user
  action, a live waterfall of every query it fired (including the eight that previously had no SQL
  visibility at all — histogram, field discovery, presence, detail hydration, load-more, the setup
  wizard), builder vs. post-macro executed SQL, and a Warnings tab that surfaces truncated results,
  dangerous `overflow_mode` settings, and errors the page itself deliberately swallows (load-more,
  sidebar presence, trace-link lookup) — all without changing that by-design silence in the page UI.
- **Server-side query stats** (off by default): an opt-in toggle tags queries with a correlation id
  and reads real ClickHouse execution stats — duration, rows/bytes read, memory, selected
  marks/parts — back out of `system.query_log`, shown in a new Stats tab. Degrades explicitly for
  missing grants, `readonly` mode, or disabled query logging, rather than a generic error.
- **Copy diagnostics bundle**: one button copies a redacted JSON bundle (span tree, timings, SQL,
  warnings, stats) for sharing — table/database names, `extraQuerySettings`, and SQL literal values
  are stripped.
- New "Additional query SETTINGS" override protection: `timeout_overflow_mode`, `read_overflow_mode`,
  `result_overflow_mode`, and `group_by_overflow_mode` can no longer be silently overridden by a
  view's advanced settings — those four keys govern whether a capped query fails loudly or
  truncates silently, and a builder's own choice there now always wins.
- New "Cluster name" advanced view setting, used by the Stats tab's `system.query_log` lookup on
  distributed deployments.

### Fixed

- Every `max_execution_time` guardrail was missing `timeout_before_checking_execution_speed = 0`,
  so an advertised N-second cap was actually enforced ~10s later than shown.
- `hydratePage`/`hydrateRow` (log detail drawer) could flash a phantom error banner for a request a
  newer search had already superseded.
- The manual refresh button could crash the page (React error #31): the underlying widget invoked
  a `() => void`-typed callback with its click event anyway, and that event ended up rendered
  directly as text one layer up.

---

## [0.5.1] — 2026-08-12

### Fixed

- Search bar: Enter now accepts a highlighted autocomplete suggestion again (ArrowDown then Enter),
  matching Kibana's own KQL input. 0.5.0 made Enter always submit, which was the wrong fix for the
  underlying bug — the real issue (accepted suggestions rewriting what was typed) was already fixed
  by 0.5.0's insert-matches-display change, so restoring Enter-to-accept no longer reintroduces it.

### Added

- Fields sidebar now splits into "Available fields" and a collapsed "Empty fields" section based on
  whether a field actually has values under the current search/filter/time range — not just whether
  it exists in the schema. Re-derives on every search/filter change, the same trigger the histogram
  already uses, via a bounded sample of the newest matching rows (mirrors Kibana's own
  existing-fields sampling). Falls back to a single "All fields" list (no split) if the presence
  check is unavailable, rather than guessing.

---

## [0.5.0] — 2026-08-12

### Changed

- Unified the two "Guess with AI" buttons in the data-view creation modal into one — it now fills
  every mapped field (timestamp, body, severity, trace ID, service name, span attributes), not
  just timestamp/body, so users who never open Advanced still get the full guess.
- Search bar autocomplete now inserts exactly what the dropdown shows — accepting a suggestion for
  a nested Map/JSON/Tuple field (e.g. `ResourceAttributes.k8s.namespace.name`) no longer silently
  strips the source-column prefix down to the bare key.
- Enter in the search bar always runs the search as typed; accepting a highlighted suggestion is
  now Tab (or a mouse click) only, so Enter can no longer silently rewrite what was typed instead
  of searching it.
- Value suggestions now match Kibana's KQL behavior: quoted for string fields, unquoted for
  numeric fields, and the dropdown label is exactly what gets inserted.
- Field-type colors (time/number/string/boolean/map/json/etc.) now match the palette Kibana uses,
  and are applied consistently across the fields sidebar, log detail drawer, and field-stats
  popover — previously only the sidebar was color-coded, and the drawer's JSON-leaf rows were
  always mislabeled as string type regardless of their real type.

### Fixed

- A KQL parse error in the search bar (e.g. from a stale saved search or URL-shared query) no
  longer silently falls back to a different, unrelated free-text body search — it now surfaces the
  parse error instead.

---

## [0.4.11] — 2026-08-12

### Changed

- Reworked the Logs Explorer histogram section: borderless toolbar buttons with a trailing chevron
  only, panel framed with a top/bottom rule instead of a boxed card, meta caption centered under
  the chart, wider y-axis gutter, px-accurate bar gaps, and a full vertical+horizontal gridline
  layout.
- Histogram legend now dims every non-hovered series' bars on hover.
- Added a chart collapse toggle to the histogram toolbar — collapses the chart while keeping the
  interval/breakdown pickers and their state.
- The results pane (histogram + table) now sits on a subtly different background than the fields
  sidebar, giving the two areas a clearer visual split.
- Field-type icons in the sidebar are now color-coded by type (time/number/string/boolean/map/
  json/etc.) instead of one flat gray, using Grafana's own visualization palette.
- Histogram meta line now reads "rows" instead of "documents" — this is ClickHouse, not
  Elasticsearch.

### Fixed

- **`SELECT *` was being double-selected.** The log-detail ("full") query aliased every mapped
  column a second time on top of its own `SELECT *`, duplicating the fetch cost for no reason —
  `logRowKey()` now reads either the grid's aliased shape or the full row's raw column names, so
  the full projection no longer needs the redundant aliases.
- **Auto-interval histogram bucketing collapsed to hairline bars on wide time ranges.** The
  bucket-size step table topped out at 1 day, so a multi-year range still bucketed by day (hundreds
  of near-empty bars) instead of scaling toward the ~60-bucket target; extended the step table out
  to yearly steps.
- **Histogram x-axis tick labels had inconsistent spacing** (and could duplicate/overlap into the
  legend) — ticks were picked by rounding a proportional index per label, which jitters between
  step sizes whenever the bucket count doesn't divide evenly; switched to a constant index step
  with edge-aware label anchoring.
- **Filter-pill context menu rendered at the viewport origin instead of under the clicked pill** —
  it read the anchor element's position from a ref in a layout effect, but the ref's callback
  identity changed every render and hadn't reattached yet on the mount that opened the menu. Now
  captures the pill's bounding rect at click time instead.

---

## [0.4.10] — 2026-08-09

### Fixed

- **KQL search bar deviated from real Kibana Query Language grammar in ways that silently produced wrong results.** Reported case: `.*xd something something with spaces.*` fanned out into five separate required (AND'd) clauses instead of being searched as one string, because the tokenizer split on every space. Real KQL treats whitespace as an ordinary character inside a value and has no implicit AND — brought the parser in line:
  - A value (bare term or `field:value`) now absorbs spaces instead of being split into multiple clauses — `os:windows 10` is one value `"windows 10"`, not two.
  - `and`/`or`/`not` must now be written explicitly between clauses, matching Kibana — `level:error service:pay` (no `and`) is a syntax error rather than a silently-inserted AND.
  - An invalid query is now refused with a Kibana-style "Expected X but Y found" message and caret shown under the search bar, instead of silently falling back to a raw-text body search with no indication anything was wrong. Results on screen are left as they were.
  - `?` is no longer treated as a wildcard — real KQL supports only `*`. A literal `?` (URLs, query strings) now matches itself instead of any single character.
  - A `field:value` whose field doesn't resolve to a real column (e.g. typing a colon-containing value like `http://x` or `12:30:45`, which reads as `field:value`) now falls back to a plain-text body search instead of emitting a broken SQL column reference that errored the whole query.
  - Added support for two more real KQL features: field-name wildcards (`datastream.*: logs` matches across every discovered field the wildcard covers) and typed `true`/`false`/`null` literals on unquoted values (`flag:true` now compares against a bare boolean instead of the string `'true'`).
  - Added `\uXXXX` unicode escapes, part of the documented grammar but previously unhandled (left a literal `u0041` in the value).
- **Quoted-phrase search (`Body:"..."`) had a SQL injection hole and silently broken regex escaping.** The generated `match()` regex pattern was interpolated into the query without ever being passed through the existing SQL-string quoting helper: an unescaped `'` in the search text could break out of the SQL string (e.g. searching `"x') OR 1=1 --"`), and single-backslash regex escapes were silently eaten by ClickHouse's own string-literal parser, so `Body:"req.id"` also matched `"reqXid"`. Both are fixed by building the regex pattern in JS and quoting it the same way every other value is quoted.
- The legacy free-text fallback path (used only when a query fails to parse as KQL) didn't escape literal `%`/`_` before using them in an `ILIKE` pattern, so those characters silently acted as SQL wildcards there while the normal KQL path already escaped them correctly.
- **A filter pill's field name could inject arbitrary SQL.** Filter pills round-trip through the URL and saved searches, so a crafted link could set `field` to something like `x) OR 1=1 -- (` and have it interpolated unquoted into the query — the identifier-quoting helper skipped quoting for any name containing `(`, `[`, or `.`, a loose heuristic meant to let already-built expressions (`Col['key']`, `Payload.user.id`) pass through, but applied identically to raw untyped text. Replaced with strict shape validation, and closed a second, more direct route to the same bug: the `exists`/`not_exists` filter operators didn't quote the field expression at all, regardless of the identifier-quoting fix.
- Discovered Map keys and JSON paths (populating the fields sidebar and filter autocomplete) were interpolated into SQL unescaped — a Map key containing `'`, or a JSON path segment that isn't a valid bare identifier (`user-id`, `k8s.io/name`), produced broken or silently different SQL instead of the intended field reference.
- `hasToken()` (used in free-text/body search) throws a ClickHouse error on any search term containing a separator character — `-`, `.`, `:`, `/`, or a space, all common in log search (`req-59`, `1.2.3.4`) — failing the whole search instead of matching. Removed: it was also redundant whenever it didn't throw, since the adjacent case-insensitive `ILIKE` match already covers everything a case-sensitive whole-token `hasToken` match could find.
- The ClickHouse datasource resolves (never rejects) its query response even when a query failed server-side — the failure surfaces via `DataQueryResponse.error`/`.errors` alongside an empty/partial result, not by throwing. Nothing in this plugin checked those fields, so every ClickHouse error (bad SQL, a query hitting its execution-time budget, permissions) silently looked like "0 results" instead of a catchable error — including every timeout guardrail already in this codebase, whose whole point was to fail loudly rather than return a wrong-looking answer. Fixed at the single chokepoint all queries run through.



---

## [0.4.8] — 2026-08-04

### Fixed

- Fields sidebar: hovering a field's row used to permanently reserve space for its filter/add-column icons on every row (even hidden), truncating the field name earlier than the sidebar's actual width allowed. Icons now only claim that space while actually revealed on hover, and no longer overlap the name text.
- Volume histogram: the y-axis number column was sized for 3-digit counts and let larger compact-formatted values ("1.5 M", "999.9 K") overflow past its left edge instead of fitting inside it.

### Changed

- Volume histogram legend narrowed (220px → 140px) to give the chart more width; truncated legend entries now show their full value in a tooltip on hover.

---

## [0.4.7] — 2026-08-04

### Fixed

- The field-stats sidebar popover built its WHERE clause without the discovered field index, unlike every other query in the app — a filter on a Map/JSON field could silently resolve differently there than in the grid/histogram, showing top-values for the wrong condition.

### Removed

- Dropped the unused Go backend scaffold (`pkg/`, Magefile, go.mod) — this plugin has always been frontend-only (`plugin.json` already declared `"backend": false`); the ping/echo resource handlers were never called by anything.

### Changed

- Internal cleanup pass: deduplicated repeated SQL-builder and query-cache logic, converted the last inline-styled modal to the shared theme pattern, fixed three pre-existing lint errors (`react-hooks/refs`, `react-hooks/set-state-in-effect`, `curly`), and split `LogsExplorer`/`VolumeHistogram`/`LogDetailDrawer` into smaller, independently-tested modules. No user-facing behavior change beyond the fix above.

---

## [0.4.6] — 2026-08-03

### Changed

- Filter pills in the Logs Explorer toolbar now match Kibana Discover's filter bar visually and functionally: click a pill to open a context menu (Edit filter, Exclude/Include results, Temporarily disable/Re-enable, Delete) instead of only being able to add or remove them. Editing reuses the existing Add-filter field/operator/value form, prefilled. Disabled pills are excluded from the query but kept in the pill list, URL, and saved searches.

---

## [0.4.5] — 2026-08-03

### Added

- Reverse half of the trace↔logs integration: a "View logs in ClickHouse Observe" button in Grafana Explore's ClickHouse trace view header, jumping back into Logs Explorer filtered to that trace, with the right data view and a time range spanning the trace (±5min) pre-selected. When a trace's datasource matches more than one configured data view, a picker lets you choose (optionally remembered per datasource); when none match, it offers all views as a fallback.

---

## [0.4.4] — 2026-08-03

### Changed

- The traceId in the log detail drawer no longer just adds an in-plugin "filter by trace" pill (redundant with the row's existing "Filter for value" action). It's now a link straight into Grafana Explore's ClickHouse trace waterfall, reusing the "View trace" link the ClickHouse datasource already generates for its own trace queries — no extra config needed beyond the datasource's own Traces defaults. Falls back to plain text when the datasource has no Traces config.

---

## [0.4.3] — 2026-08-02

### Fixed

- "Guess with AI" (and the manual column-mapping dropdowns next to it) couldn't see inside Tuple or JSON columns — a `trace Tuple(id String, span_id String)` column could only ever be offered/guessed as the whole `trace` struct, never `trace.id`. Guessing `trace` for Trace ID or `service` for Service Name then rendered the raw struct (e.g. `{"name": "my-service"}`) instead of the string. Tuple/JSON columns are now expanded into their dotted leaf fields (`trace.id`, `service.name`, JSON paths) before being offered, matching how the rest of the app already addresses them.

---

## [0.4.2] — 2026-08-02

### Fixed

- Histogram bars could render as empty when they actually held data, and the "N documents" count could be lower than a sub-range of the same view — caused by the volume query's execution guardrail silently truncating the aggregation (`timeout_overflow_mode = 'break'` + a rows-read cap) instead of erroring. Now throws on timeout so an over-budget query fails visibly rather than drawing a wrong chart.

---

## [0.4.1] — 2026-08-02

### Changed

- Removed the redundant "Copy link" toolbar button — the address bar already stays in sync with the full shareable view state, so it was copy-pasting the same thing the browser already shows.
- Moved "Saved" and "Add to dashboard" from the top toolbar row down to the Edit-as-SQL / Inspect-SQL row, right-aligned.
- Swapped the "Saved" button's icon from a save/disk icon to a search icon, so it reads as "saved searches" rather than "save this."

---

## [0.4.0] — 2026-08-02

### Removed

- Traces page (span waterfall, service map, trace list) and everything that only existed to serve it: `TraceExplorer`, `src/components/trace/`, `src/sql/trace/`, trace query builders, trace-only `ColumnMapping` fields (span ID/parent span ID/duration/span name/status code/status message/span kind/resource attributes), `SourceConfig.tracesTable`, and the corresponding capability flags.

### Changed

- The "View trace" button in the log detail drawer no longer navigates to the Traces page (which no longer exists) — it now filters the log list down to every log carrying that trace ID.

---

## [0.3.6] — 2026-07-14

### Added

- **Shareable Logs Explorer URLs.** Search, filters, columns, sort, time range, and active data
  view now encode into the URL as you work — copy the link (new "Copy link" button) and a
  colleague opens the identical view. Relative time ranges (`now-24h`) stay relative, not frozen
  to an absolute instant, matching Kibana/HyperDX convention. Columns are only encoded when
  actually customized (not the view's untouched defaults), keeping links short.
- **"Field has any value" filter button** in the field sidebar, alongside the existing
  filter-empty action — one click for `notEmpty(toString(field))`.
- **ClickHouse `Tuple`/`Nested`/`Array` column support.** Tuple columns (including nested
  tuple-in-a-tuple, flattened to dotted names like `a.x`) are now discovered as individual
  filterable/selectable fields, the same way Map keys and JSON paths already are — no extra query
  needed, parsed straight from the column's type string. `Nested(...)` and plain `Array(...)`
  columns are now typed correctly instead of falling through to `unknown`.

### Fixed

- **Log detail drawer was slow to open**, regressed by an earlier perf change that narrowed the
  list query but left the drawer re-running a whole-page `SELECT *` on every row click. Replaced
  with a single-row point lookup (millisecond-window + core-field match, `LIMIT 1`); the old
  whole-page fetch is kept only as a fallback for the rare timestamp-precision miss.
- **Logs Explorer ran its main queries twice on a cold load**, doubling the histogram's cost and
  chaining the second run behind field discovery finishing (~15s on large datasets). The queries
  no longer depend on the (async) field index directly; a guarded one-shot reconcile still re-runs
  them if a URL/saved-search filter references a not-yet-discovered field.
- **"Filter out" (and `contains`/multi-value filters) replaced an existing pill on the same field
  instead of appending.** Clicking "Filter out" on two different values for the same field used
  to silently drop the first — filters now only dedupe an exact re-add of the same field+op+value,
  so different values on the same field correctly stack as AND.
- **Log table header could visually overlap the first row** after adding a column — `position:
  sticky` on a `<th>` inside a `border-collapse: collapse` table is a known cross-browser
  fragility around reflow. Switched to `border-collapse: separate`.

### Changed

- **Toolbar condensed to one line** (Kibana Discover style): the search bar moved into the header
  row instead of its own line below, and the "Search" button shrank to icon-only (Enter still
  submits) — reclaims vertical space for the log table. Time range + refresh now wrap together as
  one unit on narrow viewports instead of separating.

---

## [0.3.5] — 2026-07-12

### Fixed

- **Log detail drawer didn't fill its pane width**, leaving dead space to the right that grew
  larger when the drawer was expanded — the panel's root element had no `width: 100%`, so it sat
  at its intrinsic content width instead of stretching to fill the splitter pane.
- **Top toolbar (Data view / filters / Saved / time range / refresh) could clip/overflow** at
  narrower viewport widths instead of wrapping to a second line.
- **Row expand/detail icon gave no feedback.** The button's hover style targeted a CSS class that
  was never actually applied (a typo'd selector), so hovering never highlighted it; the icon also
  never reflected whether that row's detail was open. It now highlights and swaps to a "collapse"
  glyph when the row's drawer is open.

### Changed

- **Fields sidebar auto-minimizes when the log detail drawer opens** (frees width for the drawer)
  and restores on close — unless it was already manually collapsed before opening.
- Sidebar collapse/expand icons switched to the double-chevron (`«`/`»`) style.
- Log detail drawer's field/value table now has zebra-striped rows.
- Minor container CSS hardening (`width: 100%` / `box-sizing: border-box`) to prevent similar
  width-collapse issues elsewhere in the Logs Explorer layout.

---

## [0.3.4] — 2026-07-11

### Added

- **Pinned columns.** A data view can now save a set of extra (non-core) columns that load with
  the grid by default — configured in the Create/Edit data view modal, reusing the same field
  discovery the sidebar already uses (including Map/JSON leaf paths). Core columns (Time/Level/
  Service/Message) stay fixed and non-removable, as before.

### Changed

- **Log detail drawer redesigned:** sans-serif field labels with a type icon per row, monospace
  values, airier rows with hairline separators, and a minimal header (severity + service +
  timestamp + nav, no redundant "Log detail" title).
- **Map attribute columns (Resource/Log/Scope Attributes) are now auto-detected**, the same way
  JSON columns already were — no config mapping required. The 3 corresponding fields in the Logs
  data-view editor are gone; the log detail drawer auto-flattens any discovered Map column, not
  just previously-configured ones.
- **KQL search no longer guesses a Map column for an unrecognized field name.** Typing a bare/
  dotted field that wasn't actually discovered (e.g. `http.method:GET` before/without discovery)
  used to silently wrap it in `LogAttributes['...']` and return nothing if wrong — it now resolves
  only via real field discovery or explicit `Col['key']` bracket syntax; an unresolved field
  surfaces a real ClickHouse error instead of a silent empty result.
- **Field-discovery scan queries (Map keys / JSON paths) are now execution-bounded**, matching
  HyperDX's own limits: `max_execution_time=15`, `max_rows_to_read=3000000`, graceful partial
  results on overflow instead of an unbounded scan. Discovery also caps concurrency at 4 scans in
  flight at once instead of firing one per column unbounded.

### Fixed

- **Severity histogram breakdown filter matched nothing.** The breakdown query used to lowercase
  severity server-side for display grouping (`lower(toString(...))`) but the filter-click action
  compared the real column against that lowercased value — `SeverityText = 'error'` never matches
  data stored as `'ERROR'`. Removed the lowercasing entirely — the histogram now displays, colors,
  and filters using the real stored casing throughout.
- **JSON fields couldn't be filtered from the log table at all.** A cell's raw value comes back as
  a parsed object for JSON fields, and the filter button was unconditionally hidden for any
  object-typed cell. Filtering now works for JSON leaf values (stringified the same way the cell
  already displays them); filtering a whole raw Map/JSON *container* column (e.g. the entire
  `ResourceAttributes` blob added directly, not a flattened leaf) is excluded on purpose — verified
  against ClickHouse directly that comparing a Map column to a stringified blob is a hard query
  error, not just a semantic no-op.

---

## [0.3.3] — 2026-07-09

### Fixed

- **Column add/remove/reorder redundantly re-ran the volume histogram query.** The logs and
  histogram queries were split into independent fetches so a column mutation only re-runs the
  grid query, not the histogram.
- **No loading cue on multi-query actions.** Rapid filter/sort/column mutations now debounce
  (~200ms) instead of firing a query burst; the volume histogram shows a dim overlay + spinner
  during a refetch instead of silently keeping stale bars.
- **Edit data view modal resized/flickered while loading columns.** The columns step now holds a
  stable min-height across the loading→loaded swap.
- **Wide tables (hundreds of columns) and large discovered field lists were slow to render.** The
  field sidebar's "Available" list is now virtualized; the per-row hover toolbar in the log table
  now mounts only for the hovered cell instead of every cell in every row.
- **JSON path discovery scanned each row's `JSONAllPathsWithTypes` twice.** Rewritten to evaluate
  it once per row, halving that query's per-row cost.
- **Map-typed fields displayed the same icon as JSON fields**, making a Map column read as JSON in
  the field sidebar. Map now has its own icon.
- **Severity breakdown in the histogram couldn't be filtered** — only field breakdowns could.
  Both bar-click and shift-click-legend filtering now work for severity too.
- **Inconsistent filter icons** across the table, histogram, field sidebar, and log detail —
  standardized on filter-plus/filter-minus everywhere.
- **Histogram tooltip capitalized severity labels** while the legend didn't. Both now match.
- **Only "Close" collapsed the log detail panel.** Clicking the already-open row now also
  collapses it; added an expand/shrink button on the panel header.
- **Non-attribute JSON columns showed as one raw stringified blob in the log detail table.** Any
  JSON-typed column now flattens into dotted-path rows, not just the four configured attribute
  containers.
- **Column-mapping fields were free-text with no column list**, and the Logs data-view editor
  showed trace-only fields (Span ID, Duration, etc.) that have no effect there. Fields are now
  searchable dropdowns sourced from the table's actual columns; trace-only fields are hidden in
  the Logs editor (Trace ID stays, since it powers the log→trace jump link).

---

## [0.3.2] — 2026-07-09

### Fixed

- **Sorting by a custom (non-core) column, then removing it, broke the query.** The column's
  sort key was a synthetic SELECT alias that no longer existed once the column was removed,
  producing an `ORDER BY` referencing an unknown identifier. Removing a column now clears sort
  if that column was the active sort target.
- **Adding the same field as a column from the log detail panel could create a duplicate
  column.** The detail panel built its own id/alias for a field instead of reusing the one the
  field sidebar uses, so the same field could end up selected twice under two different ids.
- Field sidebar could spin indefinitely if no datasource was ever configured (loading state
  never resolved).

---

## [0.3.1] — 2026-07-09

### Fixed

- **Filter pills looked flat and unclear.** Squared corners (was fully rounded), a thicker
  saturated polarity border with a matching tint instead of a flat gray chip, and negated
  exists/one-of filters now show a "NOT" prefix (e.g. "NOT field is one of [...]") — display-only,
  `filterLabel()`'s underlying text is unchanged.
- **Compare modal collapsed multi-line messages (e.g. stack traces) onto one line.** The value
  cell had no `white-space: pre-wrap`, so embedded line breaks were silently collapsed by the
  default `white-space: normal`.
- Compare button and Wrap-lines toggle had no gap between them, sitting flush against each other.

---

## [0.3.0] — 2026-07-09

### Added

- **Logs Explorer overhaul.** Resizable sidebar/table/detail panes, inline
  log detail panel (replaces the old overlay drawer), flat searchable field sidebar, zebra-striped
  rows with uniform 2-line message clamping, drag-to-reorder table columns, drag a field from the
  sidebar onto the table to add it as a column at the exact position dropped, click-to-filter
  histogram breakdown segments with a filter-for/filter-out popup, right-side histogram legend
  with isolate/toggle series clicks, auto-refresh via `RefreshPicker`, multi-row compare view,
  editable/searchable data views, and a wider add-filter popup.

### Fixed

- **Histogram's last time bucket always rendered empty.** `fillEmptyBuckets` looped `t <= end`,
  which added a spurious trailing bucket exactly at the range's end instant whenever the range
  span divided evenly by the bucket step (e.g. a round "last 1 hour") — that bucket's window only
  ever contained a single instant of query data, so it was structurally near-empty regardless of
  real events. Changed to `t < end`.
- **Infinite fetch loop when no breakdown choice was made yet.** The derived `breakdown` value
  fell back to a freshly-built object literal on every render, churning `executeQuery`'s identity
  and retriggering the effect that calls it.
- **Severity breakdown silently reset to "none" on every page load.** `FieldsContext`'s `loading`
  flag started `false` before field discovery had even begun, so the severity-fallback guard read
  "checked, no severity column" on the very first render and locked in "none" as a permanent
  explicit choice.
- **Log detail panel collapsed to a handful of raw columns after any auto-refresh, filter, or
  time-range change.** The list query's returned rows are new objects each time; the open detail
  panel's `selectedRow` kept pointing at the old, now-detached object. Re-points it at the
  matching row in the new results by content key (or closes the panel if that row no longer
  matches).
- Adding/removing a table column while defaults were still showing wiped out the whole default
  column set instead of appending/removing one.
- Histogram y-axis rendered a stray tick above the chart (dividing by a zero max produced `NaN%`
  positioning) when a bucket had no data.
- `mapKeys()` scans against Map-typed OTel attribute columns no longer run against columns that
  are actually `String`/`JSON` in the target schema (was throwing ClickHouse error 43).

---

## [0.2.15] — 2026-07-08

### Fixed

- **"Add to dashboard" histogram panel was unreadable.** The exported "Log volume" panel used
  Grafana's `barchart` panel type, which treats every row as a discrete category — with ~50-60
  time buckets that produced one raw-epoch tick per bucket, all overlapping, plus ungrouped
  side-by-side (not stacked) bars. Switched to the `timeseries` panel type (rendered as stacked
  bars via `drawStyle`/`stacking`), which has a real time axis and renders exactly like the live
  in-app histogram.

---

## [0.2.14] — 2026-07-08

### Added

- **Native ClickHouse `JSON`-column fields.** Paths inside `JSON`-typed columns (type-hinted and
  dynamic) are now discovered alongside `Map` keys and surfaced as first-class fields — sidebar,
  KQL autocomplete, filters, and column selection all work the same way they already did for Map
  attributes.
- **Collapsible JSON tree in the log detail drawer.** The JSON tab now renders a per-node
  collapsible tree instead of a flat `JSON.stringify` dump.

### Fixed

- **OTel log detail drawer could crash on real data.** `parseMapValue` passed non-string Map/JSON
  attribute values (nested objects/arrays) straight through; rendering one as a React child threw.
  Values are now stringified consistently at parse time.
- **Severity breakdown silently reset to "No breakdown" after a full page reload.** `config`
  hydrates asynchronously, so the histogram breakdown's initial state was often set before
  `caps.hasSeverity` was known. It now self-corrects once capabilities are known, without ever
  overriding an explicit user choice.
- **Histogram hid small counts next to large ones** (e.g. 10 errors against 40k info logs) —
  every non-zero stacked segment now has a minimum render height, so a rare error/warn series is
  never invisible against a dominant one.
- **Histogram tooltip could get clipped off the right edge of the screen** when hovering buckets
  near the end of the chart — it now flips to the left of the cursor instead of overflowing.
- **Histogram didn't render empty buckets** — filtering to a range with sparse data (e.g. a full
  day with a quiet stretch) now shows flat-zero bars for the gap instead of omitting it.
- Discovered Map/JSON fields (e.g. `k8s.namespace.name`) showed as bare, unprefixed names in the
  sidebar and search-bar autocomplete, making them indistinguishable from real top-level columns.
  They're now labeled with their source column (`ResourceAttributes.k8s.namespace.name`) and
  grouped under a collapsible header per source column in the sidebar; filtering/selecting the
  raw container column itself still works from the same header row.

### Changed

- Nested Map/JSON fields in the sidebar are collapsed by default (a table can have hundreds of
  discovered keys/paths) — expand a source column's group to see its fields, or just search.

---

## [0.2.13] — 2026-07-07

### Fixed

- **Nav links broken on Grafana < 10.3 (and some airgapped installs).** `plugin.json` used the
  `%PLUGIN_ID%` template placeholder in `includes[].path`; that substitution requires a Grafana
  version newer than this plugin's declared `>=10.0.0` minimum, so older instances rendered the
  literal string (`/a/%PLUGIN_ID%/logs`) instead of a working URL. Paths now hardcode the plugin
  ID directly.

### Changed

- Retook the three README screenshots (Logs Explorer, Trace Explorer, Configuration) against
  live seeded data.

---

## [0.2.12] — 2026-07-07

### Changed

- **Logs Explorer list query no longer sends `SELECT *`.** The grid query now projects only the
  columns it renders; the detail drawer lazily fetches the full row (Map attribute columns,
  "All fields", JSON tab) per page on first open, matched to the grid row by content key
  (timestamp+body+severity+service) rather than row offset, so it can never attach the wrong
  row's attributes. Raw-SQL mode is unaffected — those rows already carry whatever the user's
  own query selected. Cuts the data transferred per page/load-more substantially on tables with
  large `Map(String,String)` columns (e.g. OTel `ResourceAttributes`/`LogAttributes`/
  `ScopeAttributes`).

---

## [0.2.11] — 2026-07-07

### Fixed

- Cleared all 30 ESLint errors surfaced by the new hooks lint rules: hook-order bugs (state
  declared after use in `LogsExplorer`, `CreateDataViewModal`), a real `react-hooks/rules-of-hooks`
  violation in `VolumeHistogram` (a `useMemo` sat after an early `return null`), a ref read
  during render in the histogram's hover-band logic, and ten `set-state-in-effect` cases —
  converted synchronous datasource-list reads to lazy `useState` init, scoped-disabled genuine
  async-fetch/external-sync effects with justification comments.
- Fixed `App.tsx`'s `jsonData` fallback recreating a new object every render, which silently
  broke the `sharedViews` memoization.

---

## [0.2.10] — 2026-07-07

### Changed

- **Log detail drawer overhaul** — rebuilt as a document view: sticky
  header summary (time, severity, service, prev/next navigation), `Table` / `JSON` tabs, a real
  two-column field/value layout (long field names now wrap cleanly instead of breaking
  mid-word), a "selected only" filter, and select-text-in-log-line → "line contains" filtering.
- **Logs table polish** — per-row severity color stripe, UI-font headers (was monospace), a
  wrap-lines toggle, `↑`/`↓`/`Enter` keyboard navigation, and proper loading/empty states.
- **Volume histogram** — added a y-axis scale, horizontal gridlines, several x-axis time ticks
  (previously just two bare endpoint labels), and a legend in severity mode.
- Search bar autocomplete badges relabeled from single letters to readable short labels.

### Fixed

- The Log explorer page now scrolls only within the log table, not the whole page — it never
  adopted the `useAvailableHeight` fix already used by the Traces page for the same Grafana
  `PageLayoutType.Custom` chrome quirk.
- "Edit as SQL" no longer sends an empty query when first opened, no longer re-runs the query on
  every keystroke, and no longer fires an extra request just from toggling the mode on — typing
  is local until you click **Run query** or press **Ctrl+Enter**.
- The raw-SQL toggle button's label no longer reads as two different actions ("Edit as SQL" /
  "Edit SQL") — now a clear "Edit as SQL" / "Back to query builder" pair.

---

## [0.2.9] — 2026-07-05

### Added

- **Traces explorer** — a new OTel-native trace view: waterfall (virtualized span tree),
  service map, per-trace header stats, and a span detail drawer with events/links/attributes.
  Correlates from a log row to its trace, and from a span back to its surrounding logs.

### Fixed

- `buildLogsByTraceIdQuery` now bails out (returns an empty query) when `timestamp` or `body`
  isn't mapped, instead of interpolating `undefined` into the SQL.
- `resolveVolumeBreakdown` falls back to no breakdown when `severity` isn't mapped, instead of
  emitting `lower(toString())` with an empty expression.
- The trace detail view no longer discards span/resource attributes — the drawer's "Span
  Attributes" and "Resource Attributes" sections were always empty due to a row-mapping bug.
- `LogsExplorer`'s default-columns resolver was typed to accept `any`, silently swallowing any
  future rename/typo on `SourceConfig.columns`; now typed properly.

### Removed

- Committed build artifacts and scratch recordings accidentally left in the working tree.

---

## [0.2.8] — 2026-07-04

### Fixed

- **Core column aliases can no longer collide with a real column on an arbitrary table** —
  `buildLogsQuery`'s fixed columns (timestamp/body/severity/traceId/spanId/serviceName) are now
  aliased under `__`-prefixed names (`__timestamp`, `__severity`, ...) instead of their plain
  field name. Previously, if a table happened to have its own unrelated column literally named
  e.g. `severity` (distinct from whatever was mapped to that role), the query would emit two
  output columns with the same name — silently losing one via last-column-wins overwrite, or for
  `timestamp`/`body` specifically, failing outright with an ambiguous `ORDER BY`. This can no
  longer happen since a `__`-prefixed alias can't coincide with a real column name.
- Removed the `ResourceAttributes`/`LogAttributes`/`ScopeAttributes` aliases from
  `buildLogsQuery` entirely — dead code; the attribute-group UI already reads by the raw mapped
  column name, never by that alias.

### Note

- If you had manually reordered or removed one of the 4 default log columns, that customization
  is keyed by the old alias name and will silently stop applying after this update — just
  re-toggle the column from the field sidebar. No data loss, cosmetic only.

---

## [0.2.7] — 2026-07-04

### Fixed

- **Query builders no longer emit `undefined`/duplicate columns for unmapped fields on
  arbitrary tables** — `buildLogsQuery`'s `severity`/`traceId`/`spanId`/`serviceName` phantom
  `'' AS x` fallbacks are now dropped entirely when unmapped (previously always emitted,
  risking a duplicate-column collision with `SELECT *` and an ambiguous `ORDER BY timestamp`
  on tables that happen to have a same-named column). `buildTraceSearchQuery` /
  `buildTraceDetailQuery` now gate on `traceId` and degrade unmapped fields to constants
  instead of interpolating `undefined`. `buildVolumeQuery`, `buildMapKeysQuery`, and
  `buildSurroundingDocsQuery` now gate on `timestamp` being mapped instead of assuming it.

---

## [0.2.6] — 2026-07-04

### Added

- **"Add to dashboard"** — export the Logs Explorer's current logs table and/or volume
  histogram as real Grafana panels onto a new or existing dashboard. Filters, search,
  columns, sort, and breakdown are baked into the exported SQL (via `$__fromTime`/
  `$__toTime`/`$__timeInterval` macros), so panels stay dashboard-time-relative instead of
  freezing the range at export time. Gated behind `dashboards:create` permission.
- **Per-field descriptions in Column Mapping** — each mapping field now states what it
  actually enables (e.g. "Enables the trace-jump link…") instead of just a bare label.

### Changed

- **Removed the `severityNumber` mapping field** — it was never consumed by any SQL
  generation or rendering; a dead, confusing leftover from the OTel adaptation.
- **`grafana-clickhouse-datasource` declared as a plugin dependency** in `plugin.json`
  (previously only present in the built copy). Requires a Grafana server restart to apply.

### Fixed

- **Severity breakdown case-duplication in histogram queries** — mixed-case severity values
  (e.g. `ERROR` vs `error`) now normalize to lowercase in SQL (`lower(toString(...))`)
  instead of only in client-side rendering, so exported dashboard panels — which have no
  such client-side fold step — don't show duplicate legend entries per case variant.

---

## [0.2.5] — 2026-07-01

### Changed

- **Removed hardcoded field aliases** — KQL/filter field resolution no longer
  recognizes English synonym groups (`message`/`level`/`service`/`trace`/`span`
  and variants). Every typed field must match a real mapped column name, an
  already-qualified expression, or fall back to Map attribute lookup. No implicit
  vocabulary, on any schema — OTel included.
- **Removed hardcoded severity-level vocabulary** — the `error`/`warn`/`info`/…
  synonym expansion (`LOG_LEVEL_TO_IN_CLAUSE`) is gone along with the `level`
  alias that was its only caller. Severity queries now do plain exact/substring
  matching on the mapped column, same as any other field.
- **Trace queries no longer hardcode OTel column names** — `StatusCode`,
  `SpanName`, and `SpanId` were emitted as bare literals in trace detail/search
  queries regardless of the data view's mapping, breaking on non-OTel traces
  tables. Added `spanName` and `statusCode` to Column Mapping (mappable in the
  UI); `SpanId` now correctly uses the existing `spanId` mapping. Unmapped
  fields degrade to empty/zero instead of emitting a broken column reference.
- **`severityNumber` is now a real mapped column** instead of a hardcoded
  `isOtel`-gated literal — add it in Column Mapping (OTel preset fills it
  automatically) to enable numeric-severity queries on any schema.

### Fixed

- **`not <field> op value` on an unresolved field excluded all rows** —
  unresolved range comparisons (e.g. `not duration > 10` when `duration` wasn't
  mapped) emitted a `1=1` no-op sentinel that `NOT` flipped into "exclude
  everything," producing a false "No logs found." Range comparisons now fall
  back to the field name as a direct column, consistent with the `field:value`
  path, so real columns work even when not explicitly mapped.

---

## [0.2.4] — 2026-06-30

### Fixed

- **Timestamp picker accepted non-time columns** — "Create data view" timestamp
  dropdown now only lists columns with an actual `Date`/`Date32`/`DateTime`/
  `DateTime64(...)` type (including `Nullable(...)`/`LowCardinality(...)` wrapped),
  instead of suggesting time types first but allowing any column. Body field still
  accepts any column.
- **Empty log table when no timestamp mapped** — `ORDER BY timestamp` was hardcoded
  even when no timestamp column was mapped, causing the query to fail server-side and
  silently render "No logs found". Now omits `ORDER BY` entirely when there's no
  timestamp.

---

## [0.2.3] — 2026-06-30

### Changed

- **OTel is now explicit opt-in** — creating a data view no longer auto-infers the
  OpenTelemetry schema. A checkbox "Apply OpenTelemetry preset" replaces the silent
  auto-detect (`looksLikeOtelSchema`). OTel preset remains available via the checkbox
  and the "Apply OTel preset" button in advanced config.
- **Generic default config** — `DEFAULT_SOURCE_CONFIG` starts blank (`isOtel: false`,
  empty column mapping, no table names). The `isOtel` flag now means exactly one thing:
  the table has a `SeverityNumber` numeric column queryable by name in KQL.

### Fixed

- **Filter-pill unknown field** — fields not present in the column mapping now query
  the column directly (e.g. `"level" = 'info'`) instead of emitting broken
  `undefined ILIKE …` SQL. Matches the direct-column fallback added to the KQL path
  in v0.2.2.
- **Free-text search with no body column** — the legacy `hasToken` search path now
  returns an empty clause instead of `hasToken(undefined, …)` on tables without a
  mapped body column.

---

## [0.2.2] — 2026-06-30

### Fixed

- **Severity breakdown**: Severity option now only appears (and is only defaulted) when
  the mapped severity column actually exists in the real table schema — verified via
  `system.columns` introspection, not just the config mapping string. Stale severity
  selections auto-correct to "No breakdown" on view switch.
- **Distributed table 500 on field breakdown**: replaced `IN (SELECT v FROM top)` with
  `GLOBAL IN` — fixes _"double distributed in join"_ / _"set distributed_product_mode"_
  errors on Distributed-engine tables without requiring settings changes (works for
  read-only CH users too). Field-stats popover scalar subquery replaced with
  `sum(count()) OVER ()` window aggregate for the same reason.
- **"All fields" in log detail drawer**: `buildLogsQuery` now projects `SELECT *` so
  every table column is available in the row object; the drawer deduplicates mapped /
  aliased columns to avoid showing `Timestamp` and `timestamp` twice.
- **Empty cells for sidebar-added columns**: `makeColumnKey` prefix changed from `_f_`
  to `fld_` — the old prefix collided with the ClickHouse datasource's `_f_col_` Map
  column strip in `dataFrameToRows`, causing user-added columns to render blank.
- **Inspect SQL copy button**: falls back to `document.execCommand('copy')` when
  `navigator.clipboard` is unavailable (Grafana iframe / non-secure context).
- **TypeScript**: resolved all 10 pre-existing type errors — unused imports
  (`dateTimeFormat`, `IconButton`, `AttributeGroup`), unknown icon name `chart-bar`,
  `ConfirmModal` icon prop, unused variables (`totalHeight`, `totalCount`),
  `ds.query()` Observable/Promise union wrapping, stale `active` field in test fixtures.

---

## [0.2.1] — 2026-06-30

### Fixed

- Removed `dependencies.plugins` from `plugin.json` — Grafana was auto-resolving
  `grafana-clickhouse-datasource` from grafana.com at install time, which blocks
  installation on airgapped / offline Grafana instances. The ClickHouse datasource
  is now documented as a manual prerequisite in the README instead.

---

## [0.2.0] — 2026-06-30

### Added

#### Histogram interval + breakdown controls

Two controls sit in a header bar above the volume histogram, framed as a panel card:

- **Auto interval picker** — choose Auto (derived from time range), Second, Minute,
  Hour, Day, Week, or Month. Fine units are greyed out with a tooltip when they would
  produce more than 1 000 bars. Shows the resolved interval (e.g. "Auto - 30 minutes")
  in the header meta caption alongside the event count.
- **Breakdown picker** — searchable dropdown with three modes:
  - **No breakdown** — plain single-color bars (`#54B399`).
  - **Severity** (default when a severity column is mapped) — stacks bars by severity
    level using the existing `SEVERITY_COLORS` palette.
  - **Field breakdown** — choose any field; bars split into top-10 values + "Other"
    catch-all computed server-side via a CTE. Categorical palette + legend row below
    the chart.
- Severity is the **default when detected** (set once at mount / on data-view change);
  user's explicit choice (including "No breakdown") is never auto-reverted.

#### Panel framing for the histogram

The header bar + chart are wrapped in a single bordered card
(`border: 1px solid border.weak`, `border-radius`, `background.primary`) so the
controls read as the chart's title bar rather than a floating row. When no events
match the current query a "No events in selected time range" placeholder fills the
chart area at normal height.

#### Bucket hover highlight

Hovering a bucket shows a subtle full-height highlight band behind the bars at that
column (`theme.colors.action.hover`). The band tracks the cursor, is hidden during
drag-select, and clears on mouse leave.

#### New constants (`src/constants.ts`)
- `SINGLE_STACK_COLOR` — accent color for no-breakdown bars.
- `BREAKDOWN_PALETTE` — 10-color categorical palette for field breakdown.
- `OTHER_COLOR` — neutral grey for the "Other" series.

#### New types (`src/types.ts`)
- `IntervalMode` — `'auto' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year'`
- `BreakdownSel` — discriminated union `{ kind: 'none' } | { kind: 'severity' } | { kind: 'field'; field: FieldModel }`

#### New components
- `src/components/HistogramControls/IntervalPicker.tsx`
- `src/components/HistogramControls/BreakdownPicker.tsx`

#### Query builder (`src/sql/queryBuilder.ts`)
`buildVolumeQuery` now accepts a typed `VolumeQueryOpts` object with explicit
`breakdown` discriminated union (`none` / `severity` / `field`). Field breakdown uses
a top-N CTE with server-side "Other" aggregation in a single round trip.

---

## [0.1.0] — 2026-06-30

### Added

#### Structured filter builder ("Add filter")
A **`+ Add filter`** button now sits in the Logs Explorer toolbar beside the KQL search bar.
Clicking it opens a popup panel (portal-positioned, click-outside to dismiss) with:

- **Field dropdown** — searchable, populated from `useFields()` (same source as KQL autocomplete:
  `system.columns` introspection plus Map-key discovery via `buildMapKeysQuery`).
- **Operator dropdown** — eight operators:
  `is`, `is not`, `is one of`, `is not one of`, `exists`, `does not exist`,
  `contains`, `does not contain`.
- **Value input** — autocompletes live top values from ClickHouse via the existing
  `loadFieldValues` / `buildFieldTopValuesQuery` pipeline. Multi-select for `is one of` /
  `is not one of`; hidden for `exists` / `does not exist`. Custom values can be typed directly.
- **Custom label** (optional) — overrides the default pill label displayed in the filter bar.

Submitting adds a removable filter pill below the toolbar. Query re-runs automatically.

#### Extended `FilterOp` + `FilterPill` types (`src/types.ts`)
`FilterOp` extended from 4 to 8 values: added `one_of`, `not_one_of`, `exists`, `not_exists`.
`FilterPill` gains two optional fields: `values?: string[]` (multi-value list for `one_of` /
`not_one_of`) and `label?: string` (custom display label). Backward-compatible — existing pills
with only `field`, `op`, `value` are unaffected.

#### New SQL clauses (`src/sql/queryBuilder.ts`)
`buildFilterClause` handles the four new operators:
- `exists` → `notEmpty(toString(<expr>))`  (reuses the pattern KQL emits for `field:*`)
- `not_exists` → `empty(toString(<expr>))`
- `one_of` → `<col> IN ('a', 'b', 'c')`
- `not_one_of` → `<col> NOT IN ('a', 'b', 'c')`

Empty `values[]` guards produce `1=0` / `1=1` rather than a syntax error.
Map-accessor fields (e.g. `LogAttributes['http.method']`) work with all operators.

#### `addFilterPill` helper (`src/sql/filters.ts`)
New function `addFilterPill(filters, pill)` dedupes by `field+op` and appends the pill
object as-is, preserving `values` and `label`. Replaces the previous `addFilter` call in
`LogsExplorer.tsx`'s `onAddFilter` handler, which would silently drop those fields.

`makeFilter` now accepts an optional `extras` argument (`{ values?, label? }`) so callers
building pills programmatically don't need a separate constructor.

`filterLabel` updated to produce human-readable labels for all eight operators plus custom-label
override.

#### Filter clause tests (`src/sql/__tests__/filter_clause.test.ts`)
31 unit tests covering:
- `exists` / `not_exists` on plain columns and Map-accessor fields
- `one_of` / `not_one_of` value quoting, SQL-special-char escaping, and empty-value guards
- Existing `=`, `!=`, `contains`, `not_contains` regressions
- `filterLabel` output for all new operators and custom-label override
- `addFilterPill` deduplication and pill-field preservation

#### Custom plugin icon (`src/img/logo.svg`, `plugin.json`)
Plugin icon updated to a ClickHouse-branded logo with a magnifying-glass overlay.

#### SQL inspect panel
"Inspect SQL" toggle in the Logs Explorer shows the exact ClickHouse query being executed,
with a one-click copy button.

---

## Project layout additions

| Path | Added in |
|------|----------|
| `src/components/AddFilter/AddFilterPopover.tsx` | 0.1.0 |
| `src/components/SavedSearches/` | 0.1.0 |
| `src/sql/__tests__/filter_clause.test.ts` | 0.1.0 |

---

[Unreleased]: https://github.com/PoorTuna/clickhouse-observe-grafana/compare/v0.2.3...HEAD
[0.2.3]: https://github.com/PoorTuna/clickhouse-observe-grafana/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/PoorTuna/clickhouse-observe-grafana/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/PoorTuna/clickhouse-observe-grafana/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/PoorTuna/clickhouse-observe-grafana/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/PoorTuna/clickhouse-observe-grafana/releases/tag/v0.1.0
