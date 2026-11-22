## Feature specs — Discover

Discover is a three-region page: field sidebar (left, \~295 px, resizable and collapsible), chart (top right), results (bottom right), under a shared top bar. Every spec below was exercised on Kibana 9.5.5.

**Page layout, top to bottom**

| Row | Left | Centre | Right |
| --- | --- | --- | --- |
| 1 Session bar | Tabs (`Untitled` + `+`) | — | Tabs menu ⌄ · Share · Query in ES\|QL · ⋮ overflow · Save \[⌄\] |
| 2 Search bar | `Data view` picker · ⊕ Add filter · ⋮ Query menu · filter count badge | KQL input (full width) | Time picker · ‹ ⊕ › time-window buttons · Refresh \[Send to background\] |
| 3 Filter row | Filter pills (wrap) | — | — |
| 4 Body | Field sidebar | Chart toolbar + histogram | Edit visualization |
| 5 Body | (sidebar continues) | Tabs: Documents (N) · Patterns (N) · Field statistics | Grid toolbar |

### DISC-NAV-01 Discover tabs

- **Purpose:** keep several explorations open in one session, like browser tabs.
- **Placement:** row 1, left. Each tab shows its title; hover shows a ⋮ menu. `+` creates a tab. A ⌄ button at the right of the tab strip lists all tabs.
- **Interaction:** tab ⋮ → Rename, Duplicate, Inspect, Switch to ES|QL. Tab strip menu → Opened tabs, Recently closed (with relative times such as ‘17 seconds ago’) and Clear. Tabs are drag-reorderable.
- **Side effects:** each tab has its own query, filters, columns and time state; `_tab=(tabId:…)` is in the URL.
- **Acceptance:** a duplicated tab starts with identical state; closing a tab lists it under Recently closed for restore.
- **Grafana:** missing. Build as Scenes app state: an array of `ExploreTabState` persisted to URL + local storage.

### DISC-SEARCH-01 Data source picker

- **Placement:** row 2, far left; label `Data view` then the current name and ⌄.
- **Interaction:** opens a searchable list with sort toggle (ascending/descending), each entry a data view; managed ones carry a `Managed` badge. Header actions: Add a field to this data view, Manage this data view, Create a data view. The ⋮ beside it repeats data view actions.
- **Side effects:** switching resets columns that do not exist in the new data view; filters stay but show a warning when the field is missing.
- **Grafana:** data source picker exists; add a “dataset” picker (index pattern / stream / Loki selector) with saved definitions including time field.

### DISC-SEARCH-02 KQL query bar with autocomplete

- **Placement:** row 2, fills remaining width. Placeholder `Filter your data using KQL syntax`. Clear (⊗) appears when non-empty.
- **Interaction:** typing a field prefix (`serv`) lists matching fields with type icons (`service.environment`, `service.name`, `service.name.text`, `service.version`). After ` field :  ` it lists actual values in quotes (`"auth"`, `"checkout"`…) from a terms lookup scoped to the time range. Enter submits. Matching terms are highlighted yellow in result cells.
- **States:** when the query or time differs from the last run, the Refresh button turns green and reads `Update`; the time picker collapses to a compact badge (`1w`) to make room.
- **Data:** value suggestions call a terms-enum or terms aggregation on the field limited to the time range (Kibana setting `autocomplete:useTimeRange`).
- **Acceptance:** suggestions appear within \~300 ms of typing pause; values are quoted; selecting inserts and keeps the cursor after.
- **Grafana:** partial (Loki/ES editors). Build a shared `QueryInput` with field + value providers from the datasource `getTagKeys`/`getTagValues`.

### DISC-SEARCH-03 Query menu

- **Placement:** ⋮ button left of the query input.
- **Interaction:** Apply to all (enable/pin all filters), Clear all, Load query, Save query (saved query = query + filters), Language: KQL / Lucene toggle.
- **Grafana:** missing as a unit. Saved queries exist in Explore query history; add “saved query + filters” objects.

### DISC-FILTER-01 Filter pills

- **Placement:** row 3 under the search bar. Pill text `field: value`; value in green, negated pills prefix `NOT` and show red. A count badge in row 2 (`≡ 1`) collapses/expands the row.
- **Interaction:** click pill → menu: Pin across all apps, Edit filter, Exclude results (negate), Temporarily disable (pill is struck through), Delete. `×` on hover deletes.
- **Side effects:** app-level filters are in `_a.filters`; pinned ones move to `_g.filters` and follow you to Lens and Dashboards.
- **Filter object (as stored):** `{meta:{key:'log.level', type:'phrase', params:{query:'error'}, negate:false, disabled:false, index:'<dataViewId>', alias:null}, query:{match_phrase:{'log.level':'error'}}, $state:{store:'appState'}}`.
- **Acceptance:** disabling a pill re-runs the search without it but keeps it visible; negating flips colour and query.
- **Grafana:** partial via ad-hoc filter variables (no disable, pin or custom label). Extend with `disabled`, `pinned`, `alias` and a DSL edit mode.

### DISC-FILTER-02 Filter editor

- **Placement:** popover from ⊕ (Add filter) or Edit filter; \~1200 px wide.
- **Interaction:** row = Field combobox · Operator · Value · 🗑 · `⊕ OR` · `⊕ AND` (build nested boolean groups). Link `Edit as Query DSL` swaps to a JSON editor. Live `Preview` line. Optional `Custom label`. Buttons Cancel / Add filter (Update filter when editing). Value input is disabled with `Please select operator first...` until an operator is picked.
- **Operators:** is, is not, is one of, is not one of, greater or equal, less than, is between, is not between, exists.
- **Grafana:** missing (ad-hoc filters have only =, !=, =~~, !~~, <, >). Build a filter builder component.

### DISC-TIME-01 Time picker

- **Placement:** row 2 right of the query. Shows `Last 7 days`; absolute ranges render as `Nov 15, 01:22 → 18:43` plus a duration badge `~17h`.
- **Interaction:** clicking turns it into a text input that accepts shorthand (`-7d`, `td`, `yd`). Popover tabs Presets / Recent. Presets list shorthand on the right: Today `td`, Yesterday `yd`, Last 1 minute `-1m`, 15m, 30m, 1h, 3h, 12h, Last 24 hours (rounded) `-24h`, 3d, 7d, 30d, 90d, 1y (rounded), This week, This week until now, This month, This month until now, This year, This year until now. Footer: Calendar ›, Custom range ›, timezone row (`GMT+02:00 – Asia/Jerusalem`, ⚙ to change).
- **Time-window buttons:** ‹ Previous (shift back one window), ⊕ Zoom out (double the window), › Next.
- **Grafana:** exists (time picker, zoom out, shift). Gap: free-text shorthand input and duration badge.

### DISC-TIME-02 Refresh / Update button

- **Placement:** row 2 far right; split button with a secondary `Send to background` action (runs the search as a stored background search).
- **States:** `Refresh` (blue) when clean; `Update` (green) when query/time changed but not run.
- **Auto-refresh:** paused by default (Kibana `refreshInterval:(pause:!t)`). A chosen interval is kept in the URL (`refresh=1m`, see SHARED-STATE-02).
- **Grafana:** run-query button exists; dirty-state styling and background searches are missing.

### DISC-SIDEBAR-01 Field list

- **Placement:** left column. Search box `Search field names` with a type-filter button showing an active count. Groups, each collapsible with a count badge and ⓘ tooltip: **Popular fields** (appears after fields are used), **Selected fields** (current columns), **Available fields**, **Empty fields**, **Meta fields** (`_id`, `_index`, `_score`, `_ignored`). Footer button `Add a field` (runtime field).
- **Row anatomy:** drag handle (on hover) · type icon (colour-coded: `k` keyword blue, `t` text, `#` number green, calendar date, globe geo, `IP` red) · name · ⊕ “Add field as column” on hover.
- **Type filter:** popover `Filter by field type` with counts: Date 1, Geo point 1, IP address 1, Keyword 20, Number 3, Text 1.
- **Data:** “Available” vs “Empty” is computed from a field-existence query over the current time range.
- **Grafana:** missing. Build `FieldList` from datasource field metadata + existence sampling.
- **Observe (R5-JSON):** Map and JSON columns, and every Map key / JSON path, carry a small `Map` / `JSON` badge after the name (sidebar and Visualize field list). Hovering the type icon, name or badge shows the field name, where it comes from (`Key of Map column LogAttributes`, `Path in JSON column Payload`) and its ClickHouse type (`UInt32`, the Map's value type, a sampled `Int64`, `Dynamic(Int64, String)`). JSON paths: the path list is the whole-table `distinctJSONPaths` (metadata only); the types of dynamic (undeclared) paths come from a bounded sample (`distinctJSONPathsAndTypes` over the first 1,000 rows read), run alongside. A dynamic path seen with exactly one plain type (integers, floats, `Bool`, `String`, arrays of these) is read as the typed subcolumn `Payload.path.:Int64` (Nullable, NULL when missing), so it groups, aggregates and compares like a column; mixed / unseen / other types stay a bare `Dynamic` string field. When the whole-table query fails, the sampled paths stand in (no error). A JSON-path lookup failure no longer blocks the document flyout. KQL on JSON paths: numeric ranges use `toFloat64OrNull(toString(…))` (a missing or non-numeric value never matches), wildcards and `contains` stringify first, array paths match any element (`arrayExists`), `field:*` is NULL-safe, a value query on the whole JSON column matches nothing and `Payload:*` means "has any path"; the KQL bar drills into a JSON column like a Map (`Payload.` lists its paths).

### DISC-SIDEBAR-02 Field statistics popover

- **Purpose:** answer “what values does this field have?” without leaving the page.
- **Trigger:** click a field name. Popover anchored to the row, \~400 px wide.
- **Header:** type icon + field name; icon buttons ⊕ Add column, 📊 Add as breakdown (aggregatable fields only), filter icon = Add “exists” filter, ✎ Edit field. Below: ECS/field description, truncated with expand.
- **Body by type:**
  - keyword / IP / boolean: `Top values` — up to 10 rows of value, % and a thin progress bar, each with ⊕ filter-for and ⊖ filter-out; `Other` row for the remainder.
  - number: toggle `Top values | Distribution`; Distribution is a horizontal histogram of 10 buckets.
  - date: `Time distribution` mini bar chart.
  - text and geo: `Examples` list (from sampled docs), no aggregation.
- **Footer:** `Calculated from 5,000 sample records.` (date: `Calculated from 149,982 records.`) and a full-width `Visualize` button that opens Lens with an auto-chart (geo opens Maps).
- **Data (exact requests observed):** keyword: `sampler(shard_size:5000) → {sample_count: value_count(field), top_values: terms(field, size 10, shard_size 25)}`. Number: same sampler with `min`, `max`, `value_count`, `terms(size 10)`; Distribution adds `histogram(field, interval=(max−min)/10)`. All scoped by current query, filters and time range, `size:0`, `track_total_hits:true`.
- **Side effects:** ⊕/⊖ add a phrase filter pill and re-run; the field moves to Popular fields.
- **Edge cases:** arrays count each element (tags 20.4%, 20.2%… sum >100%); high-cardinality numbers show 10 values + `Other 87.6%`; missing fields show “No field data for the current search”.
- **Acceptance:** stats reflect current filters; percentages are of sampled docs with a value; every value row has filter-for/out.
- **Grafana:** missing. Highest-value feature to build first.
- **Observe (PARITY-GRID):** every top-value row shows ⊕/⊖ filter buttons (always visible, not on hover) and a bar gauge under the value; the caption says `Calculated from N sample records.` only when the 5,000-row sample is full, else `Calculated from N records.` (same for the Map key list's `Discovered from …`). Map columns: the key list has a ⊕ `Add <column>.<key> as column` button per key (open the popover, one click); drilling into a key shows its stats with the back link inside the panel; long names wrap instead of truncating.

### DISC-CHART-01 Hits histogram

- **Placement:** top of the right column. Toolbar left: ⇤ Hide field list · Hide visualization · Hide results table (three square icon buttons), `Auto interval ⌄`, `No breakdown ⌄`. Toolbar right: ✎ `Edit visualization`. Under the chart, centred caption: `Nov 10, 2026 @ 11:16:27.169 - Nov 17, 2026 @ 11:16:27.169 (interval: Auto - 3 hours)`.
- **Chart:** count per interval, single series in teal; a red vertical line marks “now”; partial buckets at the edges are shaded grey.
- **Interval options:** Auto, Millisecond, Second, Minute, Hour, Day, Week, Month, Year. Auto picks \~50 buckets (7 days → 3 hours; 17 hours → 30 minutes).
- **Hover tooltip:** header with bucket start (`2026-11-15 09:00`), one row per series with colour swatch, name and count, hovered series highlighted; footer `Right-click to show actions`.
- **Right-click (pinned tooltip):** tooltip freezes with a checkbox per series and actions `Filter by time` (set time range to that bucket) and `Filter N selected series` (adds filter pills for the ticked series).
- **Brush:** click-drag across the chart sets an absolute time range; the picker shows `Nov 15, 01:22 → 18:43 ~17h`; interval recomputes; URL `_g.time` becomes ISO strings.
  - The range is the exact dragged times (a 4.8 h → 14.4 h drag over a day is 04:48 → 14:24), not snapped to bucket edges, then re-bucketed. It is rounded outwards to whole seconds (the datasource time macros are second precision, so the range shown is the range queried) and is at least one second, or one pixel's worth of time, wide: a drag inside one bucket never gives an empty `from == to` range. A click (no drag) zooms to the clicked bucket, start to end, like `Filter by time`.
- **Time bounds:** every query includes both ends (`>= from AND <= to`, as Kibana), and the histogram keeps a bucket that starts exactly at `to`, so the `N rows` caption, the grid, field statistics and Visualize agree (08:00–12:00 on the fixture: 2,161).
- **Partial buckets:** a bucket only partly inside the range (starts before `from` or ends after `to`) is drawn faded on a grey band, and its tooltip says so. Not for week / month / year buckets (calendar widths).
- **Too-fine intervals:** nothing in the interval menu is disabled. A fixed Second / Minute / Hour / Day interval that would exceed 1,000 buckets is scaled up to the finest round multiple that fits (Minute over 7 days → 15 minutes), and the caption says `(interval: Minute, scaled to 15 minutes)` with a warning `⚠ Scaled to 15 minutes` (Kibana: "scaled to 10 minutes").
- **Axis:** ticks fall on round times (every 30 minutes, every hour, midnight, …), at least ~80 px apart so labels never collide. Sub-day ticks read `HH:mm` with the date as a second line on the first tick and at each new day; day ticks read `1st … 7th` with `January 2026` under the first tick and at each new month; multi-month ticks read `Jan 2026`. The axis row grows to two lines when a tick has a second line, so it never overlaps the caption.
- **Grafana:** brush-to-zoom exists in time series panels; series-selection actions and a logs-volume-style default chart exist only in Explore.

### DISC-CHART-02 Breakdown

- **Default:** `No breakdown` (a single series), as in Kibana; an explicit `bd` URL parameter wins.
- **Interaction:** `No breakdown ⌄` opens a searchable list of aggregatable fields (incl. `_index`, `_ignored`). Choosing one turns the label into `Breakdown by host.name` and stacks bars by its top values. A legend appears on the right.
- **Legend:** click an item isolates it (others shown with an eye-slash icon, y-axis rescales); Ctrl+click hides it. Hover shows ⋮ → popover titled with the value: `Filter for`, `Filter out`.
- **Also reachable from:** field popover 📊 icon (DISC-SIDEBAR-02).
- **Grafana:** partial. Need a breakdown selector bound to a `terms` group-by on the volume query and legend filter actions.

### DISC-CHART-03 Edit visualization

- **Interaction:** ✎ opens the histogram as a full Lens editor (breadcrumb `Dashboards / Visualizations / Edit visualization`) pre-populated: Bar, `@timestamp` horizontal, `Count of records` vertical, breakdown if set. Suggestions: Count of records (metric), Area stacked, Bar percentage. Save-to-dashboard from there.
- **Grafana:** “Open in panel editor” from an Explore query is the closest analogue.

### DISC-TABLE-01 Results grid

- **Placement:** below the tabs. Columns: row checkbox · expand ⤢ · `@timestamp ⏲` (sort ↓ indicator) · `Summary ⓘ` (when no columns chosen) or the selected columns. Footer: `Rows per page: 100 ⌄` and pagination.
- **Summary column:** all fields as `name value` pairs in bold/regular monospace, up to 3 lines, ellipsis. Fields matching the active query or filters are moved to the front and highlighted (`log.level error service.name payments …`).
- **Grid toolbar (right):** `Columns N` (when columns exist), `Sort fields N`, 🔍 Find in table, ⌨ Keyboard shortcuts, Display options, ⛶ Fullscreen, Save table to dashboard.
- **Display options:** Sample size (rows fetched, default 500), Density Compact / Normal / Expanded, Max header cell lines Auto / Custom, Body cell lines Auto / Custom (default 3).
- **Keyboard:** arrows move cells; Home/End row edges; Ctrl+Home/End page edges; PgUp/PgDn change page; Enter opens cell details; Esc closes.
- **Grafana:** Logs panel and Table panel cover parts; missing: summary column with match-first ordering, sample-size control, per-cell actions.
- **Observe (PARITY-GRID):** a non-time sort is tie-broken by the time field, newest first (`ORDER BY <col> <dir>, <time> DESC`). The field list keeps a 200 px minimum and the grid scrolls sideways inside its own area when columns don't fit; the message column keeps a readable minimum (~18em). Columns resize by dragging the header's right edge (or ←/→ on the focused handle, double-click resets); widths live in the column state (URL `cols[].width`, saved searches), clamped to 60–1200 px and never reach SQL or re-run a query. A cell's action bar on the first row opens below the cell so it never covers the header.

### DISC-TABLE-02 Cell actions

- **Trigger:** hover or focus a cell; a small blue action bar appears on the cell's top edge.
- **Actions:** ⊕ Filter for this `<field>`, ⊖ Filter out this `<field>`, ⧉ Copy value, ⤢ Expand. Summary/`_source` cells have only Copy and Expand.
- **Expand popover:** shows the full value (JSON pretty-printed for `_source`) with buttons `Filter for`, `Filter out`, `Copy value` and ×.
- **Grafana:** missing for logs; table panel has “filter for value” only with ad-hoc variables.

### DISC-TABLE-03 Column header menu

- **Trigger:** hover header → ⋮; header also shows drag handle and type icon. Columns resize by dragging the border.
- **Menu:** Remove column, Sort A-Z, Sort Z-A, Move left, Move right, Copy name, Copy column (all values), Edit data view field.
- **Observe (PARITY-GRID):** the header name is a button that opens the menu (it no longer sorts on click): `Sort ascending`, `Sort descending`, `Move left`, `Move right`, `Reset width` (resized columns), `Copy name`, `Remove column` (not on core columns). Drag handle on the header body reorders; the right edge resizes. Not built: Copy column, Edit data view field. A field a core column already shows (Body under `Message`) can't be added again; its field-list entry says `shown as the Message column`.

### DISC-DOC-01 Document detail flyout

- **Trigger:** row ⤢ expand icon. Opens a push flyout on the right (\~540 px, resizable via a drag handle); the main view squeezes rather than being covered.
- **Header:** `Document` + ×. Navigation `|‹ ‹ 1 of 366 › ›|` steps through result rows. `Actions:` two icons — View single document (permalink `/doc/<dataView>/<index>?id=`) and View surrounding documents.
- **Tabs:** `Table` and `JSON`.
- **Table tab:** search `Search field names or values` + type filter; toggles `Selected only` and `Hide null fields`; rows = type icon · field · value; 25 rows per page. Hover a row → 📌 Pin field (pinned rows stick to the top across documents). Value cell actions: filter for, filter out, copy, expand. Field-name cell actions: `Filter for field present`, `Toggle column in table`, plus the field description popover.
- **Grafana:** Logs panel row details has a subset (filter for/out, show stats). Missing: pinning, selected-only, next/prev navigation, push layout.
- **Observe (PARITY-GRID):** navigation covers every loaded row (`51 of 200`), fetching the next chunk when stepping past the last loaded one, and the grid follows to the document's page; ←/→ step documents, Escape closes; focus moves into the panel on open and back to the row's button on close. R4-DISCOVER: the panel overlays the right side of the grid (45 % of the results area, min 400 px, 88 % expanded) like Kibana's flyout, so the grid keeps its rows, columns and pager underneath; the single-document permalink carries the time range only inside `ret` (`doc/<view>/<ns>_<id>?ret=<discover query>`; old links with their own `from`/`to` still open); a data view with no mapped columns shows a Summary column (`key: value` of every field), and one without a time field shows a matching count (one `count()`) in the footer; a link naming a data view this browser doesn't have says so instead of silently opening another one; the histogram tooltip reads `Count of records N`; field names wrap at the dots; the toolbar wraps so the search box is never cut. JSON shows the time as ISO 8601. `View single document` opens `doc/<dataViewId>/<ns>_<id>` (the surrounding-documents anchor: epoch-ns timestamp + row-id hash), a permalink page with the same panel; a filter there returns to Discover with it.

### DISC-DOC-02 Surrounding documents

- **Route:** `#/context/<dataViewId>/<docId>`, breadcrumb `Discover / Surrounding documents`.
- **Behaviour:** title `Documents surrounding #<id>`; anchor row highlighted in pale yellow; `Load [5] newer documents` above and `Load [5] older documents` below (number editable). Query is dropped and existing filters are carried over but automatically **disabled** (struck-through pills) so neighbours from all sources show. Columns are kept.
- **Data:** two searches sorted by `@timestamp` asc/desc with `search_after` from the anchor's sort values, size N.
- **Grafana:** Loki “Show context” exists for logs; missing for Elasticsearch and as a generic pattern.
- **Observe (PARITY-GRID):** the anchor row keeps its own colour on any zebra stripe (plus an accent bar); rows are compact one-liners and the page scrolls (no inner scroll box); after `Load newer` the anchor is scrolled back into view; an `Add filter` button sits next to the pills; the detail panel is sticky and resizable.

### DISC-PATTERNS-01 Log pattern analysis

- **Placement:** `Patterns (12)` tab next to Documents. Toolbar right: `Selected 2` menu (when rows ticked), field selector chip `t message`, ⚙ options, and “Create anomaly detection job” icon.
- **Table:** checkbox · expand › · `Count` (sortable) · `Log rate` sparkline · `Examples` (one sample, constant tokens in bold purple, variable parts plain) · Actions ⊕ Filter for pattern / ⊖ Filter out pattern. 10 rows per page.
- **Expanded row:** Tokens (`Cache for key`), Regex (`.*?Cache.+?for.+?key.*?`), Examples (4 samples).
- **Selected menu:** Filter for patterns / Filter out patterns (multi-pattern filter).
- **Options:** Minimum time range (default: use time selector range), Random sampling (`On - automatic`, shows `Probability used: 30%`).
- **Data (exact):** `random_sampler(probability 0.3) → categorize_text(field:message, size:1000, analyzer: first_line_with_letters char filter, standard tokenizer, stop words for weekdays/months/GMT/UTC, limit 100 tokens) → {examples: top_hits(size 4, _source:message), sparkline: date_histogram(fixed_interval=range/~14)}`.
- **Grafana:** Loki has `pattern` parsing and Logs Drilldown has a patterns tab; missing for Elasticsearch/OpenSearch.

### DISC-FIELDSTATS-01 Field statistics tab

- **Placement:** third results tab. Table columns: expand › · Type · Name (sorted) · `Documents (%) ⓘ` (`5,000 (100%)`) · `Distinct values` · `Distributions` (eye toggle hides mini charts) · Actions (📊 explore in Lens; 🌐 for geo opens Maps).
- **Mini distributions:** keyword → tiny bar strip + `3 categories` / `top 10 of 1012 categories`; number → density sparkline with min and max labels (`1,000,000 … 293,252,164`).
- **Expanded row:** Documents stats (count, percentage, distinct values), Summary (min, median, max for numbers), Top values (value, count and %, ⊕/⊖), plus distribution chart.
- **Grafana:** missing. Build as a panel that runs one sampler aggregation per field batch.

### DISC-ESQL-01 ES|QL mode

- **Toggle:** `Query in ES|QL` (row 1) converts the current data view to `FROM logs-app-*`; button becomes `Switch to Classic` with tooltip `Search your data with data views and KQL in Classic Discover`.
- **Editor:** multi-line Monaco editor with syntax colouring; Ctrl+Enter runs; `Search` button left of the time picker; ⚡ quick-queries button. Right icons: AI assist, ☆ starred queries, 🕘 history, ? docs. Status line: `154ms | 1K documents processed | ⚠ 1 warning` (or `⊗ 1 error`).
- **Autocomplete:** after `|` lists commands (CHANGE\_POINT, COMPLETION, DEDUP, DISSECT, DROP, ENRICH, EVAL, FORK, FUSE, GROK, INLINE STATS, …); fields and functions in context.
- **Results-driven chart:** `STATS c = COUNT(*) BY service.name` switches the chart to bars per group, the sidebar to result columns (`c`, `service.name`) and the table to `5 groups` with expandable group rows and a `Group by` control.
- **Grafana:** SQL-like editors exist per datasource; missing: result-shape-driven auto chart.

### DISC-SESSION-01 Save, share, export, overflow

- **Save:** split button; secondary menu `Save as`, `Reset changes`.
- **Share:** modal `Share this Discover session`, toggle `Use absolute time range` (explains relative semantics), warning `You have unsaved changes` and `Copy link`.
- **Built (PARITY-DASHBOARDS):** `Copy link` copies a Grafana short link (`POST /api/short-urls` with the path relative to Grafana's root → `/goto/<uid>`), toggle `Short link` (on by default); while it loads, or if Grafana refuses it, the full link is used. Only a same-origin `/goto/` URL from the response is shown. The saved-search menu button is `Saved searches` (secondary, folder icon, caret, `aria-expanded`) with no tooltip, so nothing covers `+ Save current`.
- **Add to dashboard (PARITY-DASHBOARDS):** panel titles are editable (`Logs table panel title`, `Volume histogram panel title`; fields start empty and show the defaults `Logs`, `Log volume` and `Discover export` (dashboard) as placeholders, used when left empty; a table capped at 1,000 rows says so: its default title is `Logs (newest 1,000)` and its info text gives the true count at the time it was added, R4-DASH), checkbox labels sit next to their boxes, a new dashboard opens on Discover's time range (relative strings kept, else ISO; an existing dashboard keeps its own range, as Kibana stores time only when asked), a title used by another dashboard is flagged while typing and Grafana's name conflict is explained. The logs table runs the grid projection and keeps Discover's columns in Discover's order with Discover's names (`Time`, `Level`, `Service`, `Message`, user columns), narrow core columns get fixed widths, the message wraps, and the footer counts the rows shown. It stays a table, not Grafana's `logs` panel, which shows one text line per row and hides the other fields behind a details toggle. The panel keeps Discover's search on its target (`observeDiscover`: `q`, `filters`, `cols`, `sort`, `ds`, `interval`, `bd`) and the panel menu gets `Extensions → Open in Discover` (opens Discover with that search and the dashboard's time; the stored value is untrusted, filtered to those parameters, capped at 16,000 characters, decoded like any shared link). The volume legend shows the level (`error`), not `count error`. `$` inside string literals in both panels' SQL is written `$`, so Grafana never interpolates a searched value as a variable.
- **Overflow ⋮:** Open session, New session, Background searches, Export tab results (CSV), Inspect tab (requests, responses, timing), Create alert rule (from current query).
- **Grafana:** share and query inspector exist; missing: alert rule from an exploratory query in one click, CSV of all hits.

### PARITY-FIELDS Map keys as fields, empty / invalid states, filter groups (Kibana 9.5 comparison)

- **Map keys as fields.** Each Map column's keys (an unfiltered sample of the latest rows, sorted, capped at 100 per column and 6 columns) are published as ordinary `source: 'map'` fields (`ResourceAttributes.host.name`, SQL `ResourceAttributes['host.name']`): listed in the field sidebar with type icon, popover, add-as-column and filter; offered in the Add filter field picker; profiled in the Field statistics tab. The container row and its filter-scoped key popover remain.
- **Empty and invalid states.** Zero results: "No results match your search criteria", tips and "Search entire time range" (one `min` / `max` query over the time field, then the range becomes that span); the empty histogram is replaced by its text. A failed list query clears the rows and shows the error in the grid; a KQL syntax error on commit hides the previous rows and shows the error until a valid query is run.
- **Filter groups.** A pill may carry `group` (short id) and `groupOp` (`or` / `and`). Enabled pills of an OR group compile to one `((a) OR (b))` condition; AND groups are the plain AND. Pill menu: Group with next filter (OR), Match all / any in group, Remove from group. A bulk menu (⋮ left of Clear all): Enable all, Disable all, Pin / Unpin all, Invert inclusion, Remove all.
- **Field statistics.** An empty string is a value shown as "(blank)" (real columns; Map keys keep "empty = absent"); a time field shows earliest / latest instead of categories.
- **Unknown KQL field.** `nosuchfield : x` shows a warning under the bar that the field does not exist in the data view (the term still runs as a text search).

### PERF-SEARCH Newest-first windowed search, indexed wildcard text search
- The document list for the default sort (time, newest first) runs over the newest window first (1 h, 6 h, 36 h) and widens backwards only until the page is full, at most 4 queries including the full-range fallback. A window is a suffix of the range, so the rows, order and OFFSET paging equal the single query's. Other sorts, raw SQL and views without a time field run the single query. The histogram and count are separate parallel queries over the whole range. Cancellable through the run's AbortSignal.
- When the table has an `ngrambf_v1` skip index on `lower(<column>)` (found in `system.data_skipping_indices`), KQL `*term*`, `term*`, `*term` and bare substring terms compile to `lower(col) LIKE '<lower-cased pattern>'` instead of `col ILIKE`. Needles shorter than the n-gram size, inner wildcards and non-ASCII needles keep ILIKE. See `docs/data-view-setup.md`.
