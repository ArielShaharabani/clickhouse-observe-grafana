## Feature specs — Lens

Lens lets a user build a chart by adding fields, then corrects the guess through suggestions and a per-dimension editor. Its key idea: the chart is a function of *dimensions* (field + operation), and every chart type is just a different mapping of the same dimensions to visual roles.

**Page layout**

| Region | Contents |
| --- | --- |
| Top nav (right) | Explore in Discover · Inspect · ⤓ Export (PDF, PNG, CSV) · Share · Settings (`Auto-apply visualization changes`) · **Save** (primary, disabled while empty) |
| Search bar | Same unified search as Discover: Data view, ⊕ filter, ⋮ query menu, KQL, time picker, Refresh |
| Left (\~290 px) | Field list: `Records` pseudo-field first, Selected fields, Available fields, Empty, Meta; same field popovers as Discover; only aggregatable fields can be added |
| Centre | Workspace (chart) with chart title; below it a collapsible `Suggestions` strip of thumbnail cards |
| Right (\~390 px) | Toolbar: `Legend`, `Style` (XY) or chart-specific; Layer panel: chart-type switcher, sub-type (`Stacked`), ⚙ layer settings, ⌫ Clear layer, ⧉ Duplicate layer, data view per layer, then dimension groups; `+` Add layer |

### LENS-QUERY-01 Query row (R3-QUERYBAR)

- **Row:** under the toolbar, the same controls and components as Discover's header: Add filter, the query menu (Clear all, Load / Save query, pin / negate / disable all), the KQL search bar with autocomplete (values and Map keys from this view's own fields), then the filter pills. Wraps at narrow widths; the old read-only query summary in the toolbar is gone.
- **Shared context:** the bar edits the URL `q` (same params as Discover). Typing changes nothing until Enter / Search; the submit writes `q` in one history entry (push, like filters) and the chart re-runs once. Back / Forward restore the previous query.
- **Invalid KQL:** the bar shows its error; the chart area shows `The query is not valid` instead of a chart, no query is sent, Save is disabled. A `q` that arrives in the URL and does not parse is treated the same.
- **Consumers:** chart click / legend filters, Explore in Discover, Save / Add to dashboard, Inspector, data view switch and pinned filters all read the same `q` / `filters`.

### LENS-START-01 Empty state and entry points

- **Empty workspace:** illustration, `Drop some fields here to start`, sub-text `Lens is the recommended editor for creating visualizations`, feedback link.
- **Entry points observed:** Discover field popover `Visualize`; Discover histogram `Edit visualization`; Field statistics row action; Dashboards → Create visualization. Each opens Lens pre-filled with the same query, filters and time.
- **Grafana:** “Add panel” starts blank with a query editor; no field-first entry.

### LENS-AUTO-01 Automatic chart selection

Adding a field (drag to workspace or the ⊕ “Add `<field>` to workspace” hover button) runs a suggestion engine; the top-ranked suggestion becomes the chart. Observed results on a data view with a time field:

| Fields added (in order) | Chart chosen | Dimensions created | Other suggestions offered |
| --- | --- | --- | --- |
| Records | Line | X `@timestamp` (date histogram, auto) · Y Count of records | Count of records (metric), Area |
| `@timestamp` (date) | Line | X `@timestamp` · Y Count of records | Count of records, Area |
| `event.duration` (number) | Line | X `@timestamp` · Y **Median** of event.duration | Median (metric), Area |
| `log.level` (keyword) | Bar, Stacked | X `Top 9 values of log.level` · Y Count of records | Heat map, Treemap, Count of records, Pie, Waffle |
| `host.ip` (IP) | Bar, Stacked | X Top 9 values of host.ip · Y Count | Heat map, Treemap, Count, Pie, Waffle |
| `@timestamp` then `service.name` | Line | X @timestamp · Y Count · **Breakdown** Top 9 values of service.name | `service.name for each @timestamp`, Count, Tag cloud, Area, Heat map |
| `log.level` then `service.name` | Bar, Stacked | X Top 9 log.level · Y Count · Breakdown Top 9 service.name | Heat map, `log.level for each service.name` (flip), Treemap, Mosaic, Count |
| `@timestamp` then `event.duration` | Line | X @timestamp · Y Count + Median of event.duration | Count, Median, Area |
| `service.name` then `event.duration` | Bar, Stacked | X Top 9 service.name · Y Count + Median | Count, Median, Bar percentage, Tag cloud, Flip |
| `client.geo.location` (geo) | not addable in Lens | — | opens Maps from Discover instead |

Rules to implement:

1. A date field, or a metric when the data view has a time field, puts the default time field on X as an auto-interval date histogram → **Line**.
2. A keyword/IP field alone → terms on X, size **9**, ordered by count desc → **vertical stacked Bar**.
3. A number field becomes a metric with **median** by default (not average, robust to outliers); `Records` becomes **count**.
4. A second bucket field becomes the **Breakdown** (split series), not a second axis.
5. A second metric is appended to the Y group.
6. Suggestions always include: the current chart, a single-number Metric, alternate geometries (Area, Heat map, Treemap, Pie, Waffle, Mosaic, Tag cloud), and a “flip” that swaps X and breakdown.
7. Switching chart type remaps dimensions instead of discarding them: Bar → Table puts both bucket dims into `Rows` and the metric into `Metrics`; Bar → Metric puts the first bucket into `Break down by` and drops the second (Metric allows one).

### LENS-SUGG-01 Suggestions strip

- **Placement:** under the chart, header `⌄ Suggestions` (collapsible), horizontally scrolling cards (\~150×100) with an icon/preview and a label; first card `Current visualization` is highlighted.
- **Interaction:** clicking a card replaces the current visualization state; hover shows the full label as a tooltip.
- **Grafana:** “Suggestions” exists in the panel editor visualization picker; the strip and the flip/alternate dimension suggestions do not.

### LENS-TYPE-01 Chart type switcher

- **Placement:** top of the layer panel; searchable popover `Search visualizations`.
- **Types and their one-line descriptions:** Bar (Compare categories or groups of data with bars), Line (Reveal variations in data over time), Area (Compare distributions of cumulative data trends), Metric (Present individual key metrics or KPIs), Table (Organize data in structured rows and columns), Pie (Display parts of a whole in a circular format), Gauge (Show progress to a goal in linear or arced style), Heat map (Show density or distribution across two dimensions), Waffle, Region map, Treemap, Tag cloud, Mosaic, Legacy Metric (Deprecated).
- **Sub-type** (Bar, Area): `Stacked` dropdown → Stacked, Percentage, Unstacked. Line has no sub-type (Kibana Line never stacks); a sub-type kept from Bar / Area stays in the state for switching back, and an old link with `line` + `stacked` loads as a plain line.

* **Purpose:** change how the same data is shown (single number ↔ time histogram ↔ bars ↔ table) without rebuilding the query.
* **Interaction:** one control. Click the switcher (it shows the current type, e.g. `Bar ⌄`), optionally type to filter (`Metric`), then Enter or click. The workspace re-renders immediately; data view, query, filters, time range and fields are kept. No query editor, query type or field re-selection is involved. The same switch is also one click away through a suggestion card (LENS-SUGG-01), and from Discover's histogram via `Edit visualization`, whose first suggestions are `Count of records` (Metric), `Area stacked` and `Bar percentage`.
* **Parked dimensions (Kibana keeps a layer's unused columns):** a switch to a chart that can't show a dimension (Metric or Pie can't show a date histogram; only XY charts draw Style and layers) parks it in the state instead of discarding it; switching back to a chart that can show it restores the same dimension (id, interval, settings). A time field dropped on Metric or Pie returns to the chart the user came from (or a line over time), with the parked date histogram; a time field dropped on a bucket slot is a date histogram, not top values. Parked dimensions ride in the `lens` URL param, never change the chart query, and are cleaned and sanitized like visible ones.
* **Dimension remapping (observed):**

| From | Switched to | Resulting dimensions |
| --- | --- | --- |
| Bar: X `Top 9 values of service.name`, Y `Count of records`, Breakdown `Top 9 values of log.level` | Table | Rows: service.name, log.level · Metrics: Count of records |
| Table (above) | Metric | Primary metric: Count of records · Break down by: service.name · log.level dropped (Metric holds one breakdown); renders a grid of tiles, one per service |
| Discover histogram: X `@timestamp`, Y Count | Metric (suggestion) | Primary metric: Count of records; one big number |

- **Remapping rules to implement:**
  1. Metrics carry over in order to the target's metric roles (Vertical axis ↔ Metrics ↔ Primary/Secondary metric).
  2. Bucket dimensions carry over in order to the target's bucket roles (Horizontal axis, Breakdown ↔ Rows, Split metrics by ↔ Break down by).
  3. Switching to a time-based XY type (Line, Area, Bar over time) with no date bucket adds `date_histogram(@timestamp, auto)` on the horizontal axis, as LENS-AUTO-01 rule 1.
  4. Dimensions the target cannot hold are dropped; labels, formats and colours of kept dimensions are preserved.
  5. The layer is never cleared by a type switch.
- **States:** current type is ticked in the list; each entry shows icon, name and one-line description; the list is keyboard-navigable (arrows, Enter, Esc).
- **Acceptance:**
  - Metric → Bar/Line histogram and back takes one open + one selection, with no other input.
  - No kept field, filter, query or time setting changes during a switch.
  - Chart updates without the user touching a query editor.
- **Grafana mapping:** Grafana's visualization picker changes the panel type, but the query result shape does not adapt: a Stat panel needs a single aggregated value and a Time series panel needs time buckets, so switching between them with ClickHouse usually means changing the query type (Table vs Time series) or editing SQL. Missing: dimension remapping. Build as a `LensState.chartType` change that runs suggestion-engine step 5 and recompiles the query from the remapped dimensions.

### LENS-DIM-01 Dimension groups

- **XY:** `Horizontal axis` (Optional), `Vertical axis` (required), `Breakdown` (Optional). Table: `Rows`, `Split metrics by`, `Metrics`. Metric: `Primary metric`, `Secondary metric`, `Maximum value ⓘ`, `Break down by`.
- **Each dimension row:** colour swatch (series colour) or palette strip (breakdown), label, drag handle on hover; empty slot `+ Add or drag-and-drop a field`.
- **Drag & drop:** fields drag from the sidebar onto groups; dimensions drag between groups (move), within a group (reorder), onto another dimension (replace, or swap/duplicate with modifier). Full keyboard DnD: “Press space or enter to start dragging… use the up/down arrow keys to reorder… left/right arrow keys to choose drop targets”.

### LENS-DIM-02 Metric dimension editor

- **Opens:** clicking a metric dimension replaces the right panel with a flyout titled by the group (`Vertical axis`), × top-right and `× Close` bottom.
- **Data section:** `Method` toggle `Quick function | Formula`. Functions grid (two columns): Average, Count, Counter rate, Cumulative sum, Differences, Last value, Maximum, Median, Minimum, Moving average, Percentile, Percentile rank, Standard deviation, Sum, Unique Count. `Field` combobox (only compatible fields).
- **Advanced (collapsible):** `Filter by` (KQL scoped to this metric, shows `(empty)`), `Time shift` (None, 3h, 6h, 12h, 1d, 1w, 1M, 3M, 6M or typed `Enter the time shift number and unit`), Reduced time range, and for formulas `Normalize by unit` (None/per second/minute/hour/day).
- **Appearance:** Name (auto label, editable), Value format (Default, Number, Percent, Bytes (1024), Bits (1000), Duration, Custom format), Series color (hex picker), Axis side Left / Auto / Right.
- **Acceptance:** changing function keeps the field where compatible; the label auto-updates until the user edits it.

### LENS-DIM-03 Formula editor

- **Interaction:** switching to Formula converts the current quick function (`median(event.duration)`). Monaco editor with toolbar: word-wrap toggle, `⛶ Expand` (full-width editor), 📖 function reference.
- **Autocomplete:** typing `cou` lists `count([field: string], [kql]?: string, [lucene]?: string, [shift]?: string, [reducedTimeRange]?: string)` and `counter_rate(…)`, with a description popover (“The total number of documents…”). Brackets auto-close.
- **Validation:** red squiggles inline and a footer badge `⚠ 1 error`.
- **Example ratios:** `count(kql='log.level : error') / count()` (error rate), `percentile(event.duration, percentile=95)`, `sum(bytes, shift='1w')`.
- **Grafana:** expressions/transformations exist but are panel-level; per-metric KQL filter and shift arguments are missing.

### LENS-DIM-04 Bucket (Top values) editor

- **Functions:** Date histogram, Intervals, Filters, Top values. Functions incompatible with the current field show a yellow dot.
- **Top values options:** Fields (multi-field terms via `⊕ Add field`), `Aggregate by this dimension first` toggle, `Number of values` (default 9), `Rank by` (Count of records, Alphabetical, Rarity, Significance, Custom metric), `Rank direction` Ascending/Descending.
- **Advanced:** Include documents without the selected field (missing bucket), Group remaining values as "Other", Enable accuracy mode (larger shard\_size), Include values / Exclude values with `Use regular expression`.
- **Request (exact):** `terms(field:service.name, order:{_count:desc}, size:9, shard_size:25) → terms(field:log.level, size:9, shard_size:25)`, `size:0`, filters and time range in `bool.filter`.

### LENS-DIM-05 Date histogram, Intervals and Filters editors (horizontal axis / breakdown)

Added 2026-11-18 at the user's request (importance 4): the bucket flyout's other functions and their advanced options.

- **Date histogram** (date fields; the default for the data view's time field):
  - `Field` (date / converted time fields only).
  - `Customize time interval` switch — off = Auto (the Discover auto interval, ~60 buckets). On → `Minimum interval` combobox: presets Millisecond, Second, Minute, Hour, Day, Week, Month, Year, plus typed values `<n><unit>` (`ms s m h d w M y`, e.g. `5m`, `3h`, `2w`), invalid input shows an inline error. The interval is a *minimum*: when it would produce more than the bucket cap the effective interval is scaled up and the editor says so (`Interval scaled to 1h to stay under N buckets`). Calendar units (w, M, y) bucket on calendar boundaries (`toStartOfWeek/Month/Year`), fixed units on `toStartOfInterval`.
  - **Advanced:** `Include empty rows` (on by default — gap-fill empty buckets with 0 across the time range), `Drop partial intervals` (drop the first/last bucket when the time range only partly covers it), `Bind to global time picker` (on by default; off = the histogram covers only the data's own min/max instead of the picker range — only offered for a field other than the view's time field).
  - The chosen interval is in the URL / saved chart, survives reload, and the histogram brush / Explore in Discover keep it.
- **Intervals** (number fields): `Granularity` slider (auto bucket count, coarse ↔ fine) or `Create custom ranges` (rows of `from ≤ x < to` with optional label, `+ Add range`, open-ended first/last); Advanced: `Include empty rows`.
- **Filters** (any field): rows of KQL query + optional label (`+ Add a filter`, default `*` labelled `All records`), each a bucket; queries go through the KQL compiler (same escaping as the search bar).
- **Acceptance:** switching function keeps the field when compatible (yellow dot otherwise); each option changes the ClickHouse query (not just the rendering); invalid intervals or KQL never reach SQL.

### LENS-STYLE-01 Style and Legend panels

- **Placement:** toolbar buttons above the layer panel; each swaps the right panel to a settings view with `← Back`.
- **Style (XY bar):** Appearance → Bar orientation Horizontal/Vertical; Titles and text → Bar values Hide / Show, if able (“Values can only be shown if space is available”); Left axis, Bottom axis, Right axis → Axis title None/Auto/Custom, Gridlines, Tick labels, Orientation Horizontal/Vertical/Angled, Axis scale Linear/Logarithmic/Square root, Bounds Full/Data/Custom, Round to nice values.
- **Legend:** Visibility Auto/Show/Hide, Position Outside/Inside, Alignment Right/Left/Top/Bottom, Layout List/Grid.

### LENS-LAYER-01 Layers

- **Add layer menu:** `Select layer type` → Visualization (another series set, can use a different data view and chart sub-type), Annotations (event markers from a query or manual), Reference lines (static or computed thresholds).
- **Layer actions:** ⚙ settings (e.g. random sampling), Clear layer, Duplicate layer.
- **Built (XY charts, 2026-11-19):**
  - `+ Add layer` → `Select layer type`: Reference lines; Annotations (enabled only with a date histogram on the horizontal axis of a vertical chart); Visualization shown disabled ("Not available yet").
  - **Reference lines** (up to 10 per layer): `Value` Static value (a number; a new line starts at the data's highest value) or Computed (Count, Average, Sum, Minimum, Maximum, Median, Unique count of a field, over the chart's query, filters and time range); Label (drawn as text at the line), Color, Axis side Left / Right (when a metric is on the right axis), Line style Solid / Dashed / Dotted, Fill None / Above / Below. A line outside the data widens its axis so it stays visible.
  - **Annotations** (up to 10 per layer): `Type` Static date (`Annotation date`, optional `End date` for a range, format `YYYY-MM-DD HH:mm[:ss]`, browser time zone) or Query (KQL through the search bar's compiler; invalid KQL is refused in the editor; the newest 100 matching documents in the time range, ignoring the chart's query and filters, as Kibana's default "ignore global filters"); Label, Color. Markers are dashed vertical lines (ranges are shaded bands) with a hover title.
  - **Layer actions** (⋮ on the layer card): Duplicate layer, Clear layer, Remove layer. Up to 5 extra layers.
  - Layers are kept in the `lens` URL param and the draft, survive XY chart-type switches (dropped for Metric / Table / Pie), and never re-run the chart query; computed lines and query annotations run their own queries.
  - **Dashboard export:** static reference lines on the left axis become Grafana thresholds drawn as lines (dashed when every line is dashed / dotted, with area when every line fills above). Labels, computed lines, right-axis lines and annotations are not exported (no panel-level Grafana equivalent).

### LENS-XY-01 XY chart behaviour (Kibana parity, built 2026-11-19)

Compared side by side with Kibana 9.5 Lens on the fixture data; the custom-drawn Bar / Line / Area chart (`src/lens/render/XyChart.tsx`) now matches it on:

- **Tooltip:** hovering the plot shows a crosshair (a shaded band on bars, a dashed line on lines) and a tooltip at the pointer: the X value as a header (time buckets as `Jan 5, 2026 @ 09:00`), then every visible series in legend order with its colour, name and value (thousands separators; percentages in Percentage mode), the series under the pointer highlighted. Keyboard focus on a bar or point shows the same tooltip. The tooltip ignores the pointer, so clicks and brushing go through; marks have no native `title` any more (their accessible names are unchanged apart from the number format).
- **Brushing** on a time axis starts anywhere on the plot, on a bar too. A press without movement (≤ 4 px) stays a click on the mark (filter / chooser); the click that ends a drag is swallowed. On a line / area chart a click on the plot filters by the series under the pointer at that X.
- **Series colours** are stable per breakdown value: each value hashes (FNV-1a) to one of the palette's first 10 colours; values are placed in legend order, so on a collision the bigger series keeps its colour and the next takes the next free one. A value keeps its colour across chart types, re-queries and click-filters. Metric-only series (no breakdown) keep the metric's own colour, else the palette by position. Helpers: `src/lens/render/seriesColors.ts` (`assignColorSlots`, `seriesColorKey`, `hashString`) for Pie / Metric / Table later.
- **Legend / stack order** for a Top values breakdown follows its rank: total count descending by default (ascending with Rank direction Ascending), alphabetical for Alphabetical, the rank metric's total for Custom metric; `Other` and `(missing)` last. The first legend entry is the bottom of the stack.
- **Legend ⋮ → Color:** every legend entry's menu (Filter for / Filter out when the breakdown can be filtered) has a palette of 16 swatches and `Reset color`; the choice is stored by series name in `style.colors` (display-only, at most 50, `#rrggbb` only, names up to 200 characters) and wins over the metric colour and the automatic one.
- **Value axis:** nice bounds and ticks with a 1 / 2 / 5 × 10ⁿ step for about five ticks (a 140 peak → 0–140 by 20, a 420 peak → 0–500 by 100); counts (all values whole) never get fractional ticks. Applies to Full and Data bounds with "Round to nice values"; Custom bounds keep their exact ends with nice ticks inside.
- **Time axis:** ticks on round local times (seconds … minutes, hours 1/2/3/6/12, days, weeks on Mondays, months, years), bucket starts on the tick, a second row with the date (`January 5, 2026`) under the first tick and at each new day (the year for day / month steps). A date histogram on the horizontal axis has no automatic axis title (Style → Axis title Auto shows nothing, Custom still shows its text). Buckets the time range covers only in part (first / last) are shaded.
- **Lines** are drawn without a dot per point; a point shows on hover / focus at that X, or when it has no neighbour to join (a single point between gaps).
- **Numbers:** values everywhere in the XY chart (tooltip, bar values, accessible names, reference line labels) use thousands separators without abbreviation (`9,264`); axis ticks abbreviate only from a million (`1.5M`). A metric's own value format still wins.
- **Chart type switch:** while the switched chart's query runs, the previous chart stays on screen (not interactive) when only the chart type / sub-type changed, so there is no blank frame.

### LENS-INTERACT-01 Click-to-filter drilldown

- **Single dimension:** clicking a bar or point adds a filter pill for its value and re-runs.
- **Multiple dimensions:** clicking a stacked segment opens a modal `Select filters to apply` with one pre-ticked checkbox per dimension value (`service.name: checkout`, `log.level: info`) and `Cancel` / `Apply`.
- **Legend:** item ⋮ → `<value>` header, Filter for, Filter out. Click toggles visibility.
- **Time series:** brushing sets the global time range (same as Discover).
- **Grafana:** partial via data links and ad-hoc filter “filter for value” in some panels; missing multi-dimension chooser.

### LENS-INTERACT-02 Explore in Discover

- **Behaviour:** opens Discover in a new browser tab with the same data view, query, time and filters, and with the chart's bucket fields as **table columns** (`columns:!(service.name,log.level)`).
- **Grafana:** “Explore” from a panel exists for queries; missing column carry-over.

### LENS-INSPECT-01 Inspector

- **Placement:** right flyout `Inspector` with `View: Data ⌄` (Data / Requests).
- **Data view:** a table of the chart's tabular data with sortable headers, per-cell ⊕/⊖ filter actions, `Download CSV ⌄` (formatted or raw), Rows per page 20.
- **Requests view:** header "1 request was made", request name with duration (78ms), background search id, and tabs Statistics (Hits, Hits (total), Data view, Data view ID, Query time, Request timestamp), Clusters and shards, Request (JSON), Response (JSON).
- **Grafana:** Query inspector exists (Data, Stats, JSON, Query); missing per-cell filter actions.

### LENS-CHART-01 Table and Metric specifics

- **Table:** groups Rows / Split metrics by (pivot columns) / Metrics; cells offer filter-for/out actions when embedded in a dashboard; columns sortable and resizable; per-column summary row and colour-by-value.
- **Metric:** grid of tiles when broken down (label top-left, big value bottom-right, empty tiles render a dash); optional Secondary metric, Maximum value (draws a progress bar), and trend line from a date histogram.

### LENS-SAVE-01 Save and reuse

- **Save** opens the modal `Save Lens visualization`: Title, Description (optional), `Add to dashboard` Existing (with `Select dashboard`) / New / None, `Add to library` toggle; primary button `Save and go to dashboard`. Unsaved state is kept in the URL and session storage, so refresh does not lose work.
- **Grafana:** library panels exist; missing quick save-to-dashboard from an exploratory chart.
- **Built (PARITY-DASHBOARDS):** a new dashboard opens on the chart's time range. Saved time-series panels with a breakdown name each series by its value (`payments`, or `payments · Count of records` with several metrics), never `m0 payments`; count charts with Include empty rows on fill empty buckets with 0 in the panel SQL (`ORDER BY <breakdown>, b0 WITH FILL FROM toStartOfInterval($__fromTime, …) TO $__toTime STEP …`, per breakdown value; unbound: between data only), and missing buckets are never bridged (`spanNulls: false`). Other metrics leave gaps (no value, as in Visualize).
- **Share (PARITY-DASHBOARDS):** the Visualize toolbar has `Share`, the same dialog as Discover's (`Share this visualization`, `Use absolute time range`, short link, `Copy link`); the link carries `lens`, `q`, `filters`, `ds`, `from`, `to` only.

### LENS-SAVE-02 Edit in Visualize from a dashboard panel

- **Kibana:** a Lens panel on a dashboard has `Edit visualization in Lens` in its panel menu; it reopens the editor with the panel's chart, query and filters, and the dashboard's time range.
- **Built:** a panel added from Visualize carries its Visualize state on its query target (`observeVisualize`: `lens`, `q`, `filters`, `ds`, no time). The dashboard panel menu gets `Extensions → Edit in Visualize` (a Grafana panel-menu link extension) on those panels only; it opens Visualize with the dashboard's current time range. The panel stays an ordinary Grafana panel (Edit, transformations); the link is an extra way back. The stored value is untrusted dashboard JSON: only those four parameters pass, the size is capped at 16,000 characters, and Visualize decodes and sanitizes it like any shared link.
- **Save and return (PARITY-DASHBOARDS, Kibana's `Save and return`):** the link also carries the dashboard uid (`dash`, `[A-Za-z0-9_-]{1,40}`), the panel id (`panel`, a positive integer) and the dashboard's time (`dfrom` / `dto`, short dateMath / epoch / ISO strings); anything malformed is dropped and the page behaves as a plain Visualize session. Visualize then loads the dashboard once and its toolbar shows `Cancel` (back to the dashboard, unchanged, on its time range), `Save as new` (the usual dialog, title prefilled with the panel's title) and `Save and return` (primary). `Save and return` opens `Save Lens visualization` with the panel's own title and description and an info note; its `Save and return` replaces that panel in place (same id and `gridPos`, other panels untouched, also inside collapsed rows) and saves without overwrite, so Grafana's optimistic lock on the loaded `version` refuses a dashboard someone saved in between (`Someone else changed this dashboard …`); then it returns to `/d/<uid>?from=…&to=…`. A panel that has been removed meanwhile disables `Save and return` (tooltip) and leaves `Save as new`. A library panel replaced this way becomes a plain panel on that dashboard (the library element is not changed).

### PARITY-CHARTS2 (Kibana comparison #9, #28, #24/#29, #30, #18, #31)
- **Pie:** one field per slice; each slice has the value's stable colour (`stableColors`, the same as in the XY chart) or its legend pick (`style.colors`); labels "name NN%" and a legend with grouped values (`unit: locale`, a metric's own Value format wins).
- **Metric tiles:** a single tile is centred at 320 x 160; tiles per breakdown value sit in a 3-column grid with the metric name as subtitle.
- **Table:** number columns grouped (`locale`), header text wrapped instead of truncated. No row numbers are drawn.
- **Top values:** "Group remaining values as Other" is on for new buckets; a stored bucket without `other` stays off.
- **Dimension editor:** controls shrink to the panel width (no clipping at 1440 px); checkbox labels sit next to their box.
- **Dashboard export:** XY panels get per-name `color` overrides (stable colours, legend picks) from the series visible when saving (`seriesColorOverrides`). Pie panels are not coloured per slice.
- **Inspector:** the request is the SQL laid out as text (`prettySql`); "Hits" is "Result rows"; ClickHouse statistics (rows / bytes read, ClickHouse time, memory) are listed only when present; the Data view applies each metric's Value format.
