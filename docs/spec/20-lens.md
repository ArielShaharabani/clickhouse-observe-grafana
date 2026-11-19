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
- **Sub-type** (XY): `Stacked` dropdown → Stacked, Percentage, Unstacked.

* **Purpose:** change how the same data is shown (single number ↔ time histogram ↔ bars ↔ table) without rebuilding the query.
* **Interaction:** one control. Click the switcher (it shows the current type, e.g. `Bar ⌄`), optionally type to filter (`Metric`), then Enter or click. The workspace re-renders immediately; data view, query, filters, time range and fields are kept. No query editor, query type or field re-selection is involved. The same switch is also one click away through a suggestion card (LENS-SUGG-01), and from Discover's histogram via `Edit visualization`, whose first suggestions are `Count of records` (Metric), `Area stacked` and `Bar percentage`.
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
