# Testing

## Run everything
```bash
docker compose up -d --build grafana clickhouse      # stack (see PROGRESS.md env notes)
npm run typecheck && npm run lint && npm run test:ci && npm run build
npx playwright test                                   # e2e + integration, needs the stack and a fresh `npm run build`
                                                      # (1 worker, 1 retry, 15 s expect timeout locally: the stack shares a small Docker VM; retried tests show as "flaky")
```

## Layers
| Layer | Where | What |
| --- | --- | --- |
| Unit | `src/**/__tests__/` (jest, jsdom, `@swc/jest`) | Pure SQL-string tests, reducers/stores, Lens `suggest`/`compile` fixtures. Mock queries with `jest.mock('../../data/runQuery')`. |
| Component | `src/**/__tests__/*.test.tsx` (Testing Library) | Each UI feature's acceptance checks. |
| E2E per feature | `tests/features/<spec-id>.spec.ts` | `@grafana/plugin-e2e`; follow `.config/AGENTS/e2e-testing.md`. Use `tests/pages/*` page objects and `tests/fixture.ts` counts. |
| Integration | `tests/integration/*.spec.ts` | Cross-feature matrix below. Runs in full at every feature gate. |
| Flows | `tests/integration/flow-*.spec.ts` | Spec FLOW-1, -2, -4 (FLOW-3 once Patterns exists; FLOW-5 is ES\|QL, out of scope). |

## Fixture (`tests/fixture.ts`)
`default.spec_logs`, data view `spec-fixture`, window 2026-01-01..2026-01-08 UTC.
`SeverityNumber` = OTel numbers (debug 5, info 9, warn 13, error 17). Latest-5,000 sample (popover): info 3,483 · warn 792 · debug 487 · error 238.
Totals: 41,520 rows; info 28,265 · warn 6,080 · debug 3,984 · error 3,191; payments 9,264; payments errors 1,575 (incl. 1,200 incident rows on 2026-01-05 09:00–11:00).

## Integration matrix
Enable a case as soon as both sides exist. Status: `—` not yet possible · `todo` · `✅`.

| Case | Covers | Status |
| --- | --- | --- |
| IT-A | Filter producers (popover ±, exists, cell actions, drawer, legend, histogram series, patterns, stats tab, Lens click/chooser) → filter store → consumers (count, histogram, grid, popover, patterns, stats tab) refresh | Grid, drawer, field list, popover, histogram right-click (`one_of` series), Lens chart click / chooser / legend ✅ (`tests/integration/it-a-filter-producers.spec.ts`); legend/patterns/stats tab/Lens later |
| IT-B | Pill disable / negate / edit / delete / pin re-query; pin survives navigation to Lens | Logs page ✅ (`tests/features/disc-filter-01.spec.ts`; edit → #19); Lens part pending #11 |
| IT-C | Dirty query/time → Update → all panels and highlight refresh | Query part ✅ (`tests/features/disc-search-02.spec.ts`); time has no dirty state (D9) |
| IT-D | Time writers (brush, filter-by-time, shift/zoom, Lens brush) → URL time, interval, Empty field grouping | — |
| IT-E | Breakdown via popover icon and toolbar; carried into Lens | Popover icon ✅ (`tests/features/disc-sidebar-02.spec.ts`); Lens part pending #15 |
| IT-F | Column writers (sidebar, drawer, column menu, Explore in Discover) → grid + context view | — |
| IT-G | Discover → Lens handoff (Visualize, Edit visualization, stats tab) | ✅ lens-interact-02 (stats tab: #22) |
| IT-H | Lens → Discover (filters, time, bucket columns, consistent counts) | ✅ lens-interact-02 |
| IT-I | Drawer → surrounding documents (filters disabled, query dropped, columns kept) | — |
| IT-J | Data view switch (columns pruned, filter warnings, fields reload) | — |
| IT-K | URL reload restores state; Lens unsaved state survives refresh | Logs page ✅ (`tests/features/shared-state.spec.ts`); Lens draft ✅ (`tests/features/lens-save-01.spec.ts`) |
| IT-M | Same actions everywhere via the action registry | ✅ names/tooltips asserted on grid, drawer, popover, field list; grid Expand popover uses the same Filter for/out/Copy (`tests/features/disc-table-01.spec.ts`) |
| IT-N | Autocomplete scoped by filters/time (KQL bar today; filter builder, Lens pickers later) | KQL bar ✅ (`tests/features/shared-autocomplete.spec.ts`) |

### DISC-TIME-01 (PR 18)
| Case | Status |
| --- | --- |
| IT-C | Query + time dirty states -> Update -> count/grid/URL refresh ✅ (`tests/integration/it-c-d-time.spec.ts`) |
| IT-D | Brush (epoch-ms URL, interval recomputed), Filter by time (interval kept), shift/zoom (interval kept), shorthand + reload ✅ (`tests/integration/it-c-d-time.spec.ts`); Lens brush and Empty-field grouping not covered (grouping exists only with FIELD features) |

### DISC-FILTER-02 (PR 19)
| Case | Status |
| --- | --- |
| IT-B | Edit now covered for builder-made pills (`tests/features/disc-filter-02.spec.ts`: "IT-B: edit a builder-made pill ...", "IT-B: a builder-made range pill can be negated, disabled and deleted") ✅. Lens part still pending #11. |

DISC-FILTER-02 acceptance:

| Criterion | Test / status |
| --- | --- |
| Popover from Add filter; Edit filter reuses it, button "Update filter" | e2e "IT-B: edit a builder-made pill ..."; unit "editing a pill prefills it ..." |
| Field combobox (searchable) with type info | e2e (every builder test picks via the combobox); type shown in option description. No type icons (gap left: text type label only) |
| Operator list depends on field type | unit "DISC-FILTER-02 operator lists"; e2e "operator list depends on the field type" |
| Range validation (numbers / dates / From <= To), invalid pills skipped | unit `validateRange`, SQL `incomplete or invalid ranges are skipped`; e2e "invalid bounds are rejected in the form", "pills with a missing or non-numeric range bound ..." |
| Whole Map column offers no range operators; Map-key ranges are numeric and Exclude is the complement | unit operator lists, SQL `Map negations ...`; e2e "a whole Map column ...", "Map-key range pill from a link ..." (1,200 slow rows; exclude 40,320) |
| Operators: is, is not, is one of, is not one of, greater or equal, less than, is between, is not between, exists | e2e one test per operator (counts: ServiceName payments 9,264; SeverityNumber >= 13 = 9,271; < 9 = 3,984; between 9..13 = 34,345; not between = 7,175; one of auth+payments 17,328); SQL `every operator produces its WHERE` |
| Value input disabled with "Please select operator first..." | unit "blank form ..."; e2e "value input is disabled until an operator is picked ..." |
| Value autocomplete from the shared service | e2e "value autocomplete suggests real values from the shared service" (info / warn / debug / error) |
| Live Preview | e2e (is, is between); unit (edit) |
| Optional custom label | e2e "custom label replaces the pill text" |
| Cancel / Add filter | e2e "Cancel closes the builder ..."; Add stays disabled until complete (e2e + unit `isFilterComplete`) |
| Hostile values | SQL tests (quotes, backslashes, `') OR 1=1 --`) for all value ops; e2e "hostile value is data, not SQL" |
| IT-B: builder-made pills re-query on edit / negate / disable / delete | the two IT-B e2e tests |
| Rows with OR / AND nested groups (`+ OR`, `+ AND`) | gap left: needs a nested pill model; separate feature |
| Edit as Query DSL (JSON editor) | gap left: Elasticsearch concept, no ClickHouse equivalent |
| ~1200 px wide popover | gap left: kept at 760 px (all three inputs fit; no change in behaviour) |

### LENS-DIM-04 (PR 20)
| Case | Status |
| --- | --- |
| Top values rank | Alphabetical asc top 1 = auth, desc = payments; fixture `spec-fixture` (e2e) |
| Top values Other | Top 3 + Other: payments 9,264, Other 16,128 (e2e) |
| Top values include/exclude | exclude payments; regex include `pay.*` / `front.*`; hostile include value returns nothing (e2e) |
| SQL escaping | hostile quotes/backslashes/`$__` in values stay in literals (jest `topValues.test.tsx`) |
| URL validation | invalid rankBy/rankDir/lists dropped, extra props removed (jest) |

LENS-DIM-04 acceptance:

| Criterion | Test / status |
| --- | --- |
| Rank by Count / Alphabetical / Custom metric | jest `ascending count, alphabetical ... custom metric ranking`; e2e `rank alphabetically` |
| Rank by Rarity, Significance | gap left: Rarity is count ascending; Significance needs a background set, not meaningful here |
| Rank direction | jest + e2e `rank alphabetically` |
| Group remaining values as Other | jest `Other: ...`; e2e `Top 3 + Other` |
| Include documents without the field | jest `missing values become "(missing)"`; no e2e (fixture has no null ServiceName) |
| Include / Exclude values, regex | jest `include / exclude ...`; e2e `exclude values, and include by regular expression` |
| Multi-field terms, Aggregate by this dimension first, accuracy mode | gap left: out of scope for this step (see Decision) |
| Saved panels / dashboard mode | jest `dashboard mode and saved panels carry the options` |
| Click-to-filter on Other / (missing) | jest `shaping: synthetic ...` (flags drive the click guard); no e2e |
| Order follows rank, Other last | jest `outer order follows the rank`; e2e `alphabetical rank lists values in alphabetical order` |
| Missing on Map keys, real "Other" kept apart | jest `missing on a Map key ...`, `shaping: synthetic ...` |
| Regex / list validation | jest `regexError`, `listError`, editor UI test; e2e `invalid regular expression` |
| Hostile values | jest `hostile values stay inside a string literal`, `macro text ... hex-escaped`; e2e hostile include |

### DISC-CHART-02 (PR 22)
| Case | Status |
| --- | --- |
| Breakdown picker | `No breakdown` → search `servicen` → ServiceName: label `Breakdown by ServiceName`, URL `bd=field:col:ServiceName`, five services in the legend; Escape closes (e2e `disc-chart-02.spec.ts`) |
| Legend isolate / hide | click auth isolates (4 eye-slash icons, rows unchanged 41,520); Ctrl+click hides payments only (e2e); y-axis rescales to the visible series (jest `VolumeHistogram.legend.test.tsx`) |
| Legend ⋮ actions | Filter for payments → 9,264 rows + pill; Filter out → 32,256 (e2e); no menu for `other` or without a target field; Escape; focus moves in (jest) |
| IT: DISC-SIDEBAR-02 × DISC-CHART-02 | field popover "Break down histogram by ServiceName" → label + legend Filter for auth → 8,064 (e2e) |
| IT: SHARED-ACTION-01 × DISC-CHART-02 | legend filter pill comes from `valueActions`, same pill shape as cells / popover (e2e + jest) |
| IT: severity breakdown | `Breakdown by Severity`; legend Filter for error → 3,191 (e2e) |

DISC-CHART-02 acceptance:

| Criterion | Test / status |
| --- | --- |
| `No breakdown ⌄` opens a searchable list of aggregatable fields | e2e "No breakdown → search and pick a field"; field list = `isBreakdownField` (existing) |
| `_index`, `_ignored` entries | gap: Elasticsearch meta fields, nothing equivalent in ClickHouse |
| Label becomes `Breakdown by <field>`; bars stack by top values; legend on the right | e2e (label, legend); jest `triggerLabel`; stacking is the existing top-10 query |
| Legend click isolates; others show eye-slash; y-axis rescales | jest "click isolates a series…"; e2e "legend: click isolates…" |
| Ctrl+click hides it | jest + e2e |
| Hover shows ⋮ → popover titled with the value: Filter for / Filter out | jest "⋮ opens a popover…"; e2e "legend ⋮ → Filter for…" |
| Also reachable from field popover 📊 (DISC-SIDEBAR-02) | e2e "IT: breakdown chosen from the field popover…" |

### DISC-DOC-02 (PR 23)
| Case | Status |
| --- | --- |
| IT-I | Drawer → surrounding documents: filters disabled, query dropped, columns kept; re-enable a filter re-queries; breadcrumb back restores Discover ✅ (`tests/features/disc-doc-02.spec.ts`) |
| IT-F | Context view part: Discover columns (incl. a Map key column) kept ✅ (`tests/features/disc-doc-02.spec.ts` "IT-F: Discover columns are kept") |
| IT-B | Pinned filter arrives disabled on the context page, store unchanged ✅ (`disc-doc-02.spec.ts`) |
| SQL | Surrounding / anchor lookup SQL strings, size clamp, hostile anchors, hostile filter values (jest `src/sql/__tests__/surrounding.test.ts`); URL helpers, hostile `ret`, untrusted `cols` (jest `src/data/__tests__/surrounding.test.ts`) |

DISC-DOC-02 acceptance:

| Criterion | Test / status |
| --- | --- |
| Route `#/context/<dataViewId>/<docId>`, breadcrumb `Discover / Surrounding documents` | e2e "opens from the detail panel ..." (path, breadcrumb) |
| Title `Documents surrounding #<id>` | e2e (heading) |
| Anchor row highlighted | e2e (`data-anchor` row, position 6 of 11) |
| `Load [5] newer documents` above / `Load [5] older documents` below, number editable | e2e "Load [N] newer / older documents, with an editable step" |
| Query dropped; filters carried over but disabled (struck through) | e2e "IT-I: query dropped, filters carried over disabled ..." |
| Columns kept | e2e "IT-F: Discover columns are kept" |
| Two searches asc/desc with search_after from the anchor's sort values, size N | jest `buildSurroundingDocsQuery` older / newer / anchor; e2e tie order at 09:00:30 and 09:01:00 |
| Entry from the document flyout ("View surrounding documents") | e2e (all tests open it from the detail panel); re-anchor e2e |
| Bad / unknown links | e2e "malformed or unknown document links ..."; jest hostile anchors |
| "View single document" permalink (DISC-DOC-01 header) | gap: not built |

### URL-COLS (PR 24)
| Case | Status |
| --- | --- |
| Hostile `cols` (expr/alias with `FROM system.users --`, subqueries, hostile core expr) dropped or rebuilt from the mapping; types checked; duplicates dropped; strict mode keeps only discovered fields / Map keys (jest `sanitizeColumns.test.ts`) | ✅ |
| `buildLogsQuery` never emits an unsafe alias / expression; hostile sort column and direction fall back (jest `sanitizeColumns.test.ts`) | ✅ |
| Crafted link renders without the injected column; hostile core column uses the mapping; hostile sort falls back; a legitimate Map key column from a link is kept (`tests/features/sec-url-cols.spec.ts`) | ✅ |

### LENS-DATAVIEW (PR 25)
| Case | Status |
| --- | --- |
| IT-G | Discover → Visualize via the toolbar "Explore in Visualize" keeps q, filters, ds and relative time (`tests/features/lens-dataview.spec.ts`) ✅ |
| IT-K | Visualize from a static link restores the tab context (`lens-dataview.spec.ts` side-menu test); a link with its own context wins ✅ |
| Pins (D7) on Visualize | stored pin merged when the URL has no filters; pinned pill disabled on another table and enabled again on its own; plain pill disabled on another table (`lens-dataview.spec.ts`; jest `dataview.test.ts`) ✅ |
| View switch | dimensions on missing fields dropped, query/time kept, chart re-queried against the new table, URL ds applied on load and carried by Explore in Discover (`lens-dataview.spec.ts`) ✅ |
| Discovery | `fieldsFor` keeps the old table's key until the new table publishes (jest `FieldsContext.test.tsx`) ✅ |

LENS-DATAVIEW acceptance:

| Criterion | Test / status |
| --- | --- |
| Data view picker in the Visualize search bar | e2e "#16b: Visualize has a data view picker …" |
| Switch keeps query, time; drops fields the view lacks | same e2e; jest `visualizeEntry` / `filtersForViewSwitch` |
| Chart re-queries the new view | e2e "the chart re-queries the new view" |
| Pins follow D7 on a switch | e2e "#16b / D7 …"; jest `filtersForViewSwitch` |
| URL data view applied on Visualize; carried to Discover | e2e "the URL data view applies on Visualize …" |
| Labeled Explore in Visualize on Discover, same context incl. time | e2e "#16c / IT-G …"; jest "Explore in Visualize link" |
| Side-menu Visualize restores the last context | e2e "#16c: Visualize from the side menu …"; jest last-context suite (untrusted input) |
| Side-menu Visualize clicked while already on Visualize | re-enters via the same `visualizeEntry` (effect on an emptied URL); jest covers the function, no e2e (Grafana's nav menu docking varies) |
| Per-layer data view (spec 20-lens.md:13) | gap left: LENS-LAYER-01 (#28) |

### DATAVIEW-TIME (PR 30)
| Case | Status |
| --- | --- |
| Converted time fields (epoch s / ms / ns, ISO text) find every fixture row in the fixture range and filter by level (`tests/features/dataview-time.spec.ts`, fixture view `default.spec_logs_epoch` from `scripts/clickhouse-init/05_dataview_time_fixture.sql`) | ✅ |
| Converted epoch ms over the incident window matches the native view's count | ✅ |
| Edit data view: switch time column, epoch unit guessed from a sample, saved to the personal view | ✅ |
| Configuration page: shared view lists the table's columns, time field picker offers number / text columns with conversion flagged | ✅ |
| `timeExpr` per format, hostile stored config, column kinds, every query builder + Lens through `timeExpr` (jest `src/sql/__tests__/timeExpr.test.ts`) | ✅ |
| Picker options / defaults / guess / note, `omitKeys`, schema-query escaping (jest `src/components/__tests__/TimeFieldSelect.test.tsx`) | ✅ |

### DISC-FIELDSTATS-01 (PR 30)
| Case | Status |
| --- | --- |
| IT-A | Stats tab as producer (expanded row Filter for → count + stats refresh) and consumer (URL filter → 1 category, 27.4% payments errors) (`tests/features/disc-fieldstats-01.spec.ts`) ✅ |
| IT-G | Stats tab Visualize → Visualize page with the same query (`disc-fieldstats-01.spec.ts`) ✅ |
| Table | documents %, distinct, keyword strip / numeric sparkline, eye toggle, name filter, back to Documents (`disc-fieldstats-01.spec.ts`; jest `FieldStatsTab.test.tsx`) ✅ |
| SQL | one sample per batch, positional aliases, numeric-only summary, absent stand-ins dropped (jest `field_stats.test.ts`); checked against ClickHouse on the fixture (3,483 / 792 / 487 / 238) ✅ |

### SHARED-PERF-01 (PR 30)
| Case | Status |
| --- | --- |
| Loading bar on Discover appears while queries run, disappears after (`tests/features/shared-perf-01.spec.ts`, queries delayed with page.route) | written, e2e not run (coordinator) |
| Slow Discover query: "Still running" chip after 2 s, Cancel stops loading, no error banner, cancelled notice dismissible (`shared-perf-01.spec.ts`) | written, e2e not run (coordinator) |
| Visualize: bar while the chart runs; Unique count note shown, exact metrics have none (`shared-perf-01.spec.ts`) | written, e2e not run (coordinator) |
| QueryProgress unit: idle renders nothing, bar immediate, chip after delay, Cancel → onCancel + notice, new run clears notice, finished run leaves none; `formatElapsed`; `lensApproxNote` (jest `QueryProgress.test.tsx`) | ✅ |
| Map keys popover caption says "sample records" (jest `FieldKeysPopover.test.tsx`) | ✅ |

### LENS-DIM-03 (PR 30)
| Case | Status |
| --- | --- |
| Formula parse / compile / precedence / functions | jest `src/lens/__tests__/formula.test.ts` ✅ |
| Injection attempts (SQL in formula, field names, KQL quotes, unknown functions, nesting/length limits, `$` in dashboard mode) | jest `formula.test.ts` ✅ |
| URL codec + sanitizeLens for formulas (unknown keys dropped, foreign field expr dropped, invalid formula dropped) | jest `formula.test.ts` ✅ |
| Editor: convert quick → formula, apply on blur, error badge, autocomplete + bracket auto-close, function reference, back to quick | jest `src/lens/__tests__/FormulaEditor.test.tsx` ✅ |
| E2E: URL formula runs (errors per service 1,575 / 445); convert + edit + reload; autocomplete + error badge; foreign-field formula from a shared link dropped and no SQL from it sent | `tests/features/lens-dim-03.spec.ts` — not run yet (coordinator) |

### LENS-DIM-05 (PR 33)
| Case | Status |
| --- | --- |
| Interval grammar: accepts `5m`, `3h`, `1M`, `250ms`, `9999d`; rejects `0m`, `1.5h`, `1H`, SQL fragments, macros, non-strings (jest `dateHistogram.test.tsx`) | ✅ |
| Resolution: auto unchanged; typed interval used as is; scaled up past 500 buckets in the same unit; calendar stepping (jest) | ✅ |
| SQL: typed units, ms on DateTime64, scaled interval used, saved panels `greatest(n, $__interval_s)` / calendar (jest) | ✅ |
| URL: options round-trip; hostile interval drops the dimension; unknown keys stripped (jest) | ✅ |
| Shaping: empty rows over the picker range (bound), off, unbound, drop partial (chart + table), calendar months (jest) | ✅ |
| Hand-offs: Discover interval → Visualize and back (jest) | ✅ |
| Editor: switch reveals Minimum interval and bucket size; scaled notice; advanced options; Bind only for another date field (jest) | ✅ |
| e2e: typed `1d` → 7 bars, reload keeps it; invalid `1x` rejected; hostile interval in a link never reaches SQL; Drop partial 7 → 6 bars; Discover `interval=day` → Visualize `1d` → Explore in Discover `day` (`tests/features/lens-dim-05.spec.ts`) | e2e not run (coordinator) |
| Intervals / Filters SQL: automatic width CTE, custom ranges `multiIf`, Filters `arrayJoin`, KQL escaping, invalid KQL matches nothing, saved-panel labels escaped (jest `rangeFilters.test.tsx`) | ✅ |
| Intervals / Filters state: round-trip, untrusted input cleaned, sanitize keeps Filters; shaping labels, empty widths, breakdown series; function switching; Metric/Pie keep them; saved panel partitions by a Filters breakdown (jest) | ✅ |
| Editor: Functions grid → Intervals, custom range edited on blur (non-number rejected), Add range; Filters invalid KQL message, Add a filter; Date histogram disabled without a date field (jest) | ✅ |
| e2e: Filters counts (errors 3,191, payments 9,264, All records 41,520); Intervals labels; Functions grid → Intervals custom ranges → Filters with invalid then valid KQL (`lens-dim-05.spec.ts`) | e2e not run (coordinator) |

### LENS-DIM-02-ADV (PR 33)
| Case | Status |
| --- | --- |
| Span parser rejects sign / decimals / unknown unit / injection text; formats (number, percent, bytes, bits, duration, custom) and Grafana units; `cleanMetricOptions` / `decodeLens` drop unknown keys and invalid values; options survive a function change; labels (jest `metricOptions.test.ts`) | ✅ |
| Filter by → conditional aggregate, escaped values, invalid KQL → `countIf(0)`; time shift ARRAY JOIN / copy conditions / window prefilter; tampered shift never reaches SQL; formulas get `__s = 0`; reduced range (not with a date histogram); normalize (app constant, dashboard `$__interval_s`); `$` escaped in dashboard mode (jest `metricOptions.test.ts`) | ✅ |
| Generated SQL (shift + filter + normalize + formula + breakdown; reduced range + month shift percentile; dashboard shift) runs on ClickHouse 26.3 against the fixture (manual, read-only) | ✅ |
| Field config defaults / per-metric overrides, no colour with a breakdown, metric/table panels and exported dashboard panels; XyChart colour, format and right axis; editor: KQL validation, shift presets / typed / garbage, reduced range disabled with a date histogram, normalize, formula note (jest `metricAppearance.test.tsx`) | ✅ |
| e2e `tests/features/lens-dim-02-adv.spec.ts`: Filter by gives per-service error counts and lands in the URL; invalid KQL not applied; time shift preset → ARRAY JOIN + "(1d ago)" label; tampered shift in a link never reaches SQL; XY right axis with Bytes format and fixed colour | ⏳ (coordinator) |

### DISC-SEARCH-03 (PR 38)
| Case | Status |
| --- | --- |
| Saved queries store: add / update / delete, sort by name, data-view scoping, case-insensitive name conflict (jest `savedQueries.test.ts`) | ✅ |
| Hostile storage: malformed entries dropped, bad filter ops / non-string values dropped, SQL-ish time bounds dropped, oversize entries dropped, corrupt JSON → [] (jest `savedQueries.test.ts`) | ✅ |
| Apply to all: enable / disable / pin / unpin / invert, applicable items only, pinned-store mirror for pin / invert / unpin (jest `queryMenu.test.ts`) | ✅ |
| Menu: save with filters + time and load back, Save changes / Save as new after load, duplicate name rejected, Apply to all + Clear all callbacks, KQL / Lucene section (jest `QueryMenu.test.tsx`) | ✅ |
| E2E: save → Clear all → load restores query + filters and counts; duplicate name; Apply to all disable / enable / invert counts; hostile stored query sanitized on load; language section (`tests/features/disc-search-03.spec.ts`) | ⏳ coordinator |

### LENS-INSPECT-01 (PR 38)
| Case | Status |
| --- | --- |
| Table columns / roles, cell filter values (synthetic and "(value)" spelling), sorting with empty cells last, CSV quoting + formula-injection prefix, raw vs formatted CSV, safe file name (jest `inspector.test.tsx`) | ✅ |
| Inspector UI: 20 rows per page, sort toggles `aria-sort`, Filter for / out add `=` / `!=` pills, no actions on metric cells; Requests view shows only `lens` roots with Hits / Rows read / Data view and the SQL / response tabs; empty states (jest `inspector.test.tsx`) | ✅ |
| E2E: Inspect on a top-values bar → table rows match the fixture, sort by count, Filter for payments adds the pill + URL filter and the table re-runs; Download Raw CSV content; Requests view Hits 5, Table, Status, SQL, response (`tests/features/lens-inspect-01.spec.ts`) | written, not run (coordinator) |

### DISC-NAV-01 (PR 38)
| Case | Status |
| --- | --- |
| Model: sanitize round-trip, tampered store (bad ids, dup ids, unknown view / params, malformed filters, oversized params, control-char titles), caps, add / duplicate / close / restore / clear / rename / move, last tab can't close (jest `src/state/__tests__/discoverTabs.test.ts`) | ✅ |
| Host: link without `_tab` loads into the active tab; side-menu entry reopens the active tab; unknown `_tab` opens a new tab; switch / add / close keep each tab's state; rename Enter / Escape; tampered storage sanitized before the URL, titles rendered as text (jest `src/pages/__tests__/DiscoverTabsHost.test.tsx`, LogsExplorer mocked) | ✅ |
| E2E: tabs keep their own query and counts, `+` keeps the data view; duplicate = identical state; close → Recently closed ("seconds ago") → restore; rename survives reload and the side-menu link reopens the active tab; Visualize side-menu restore uses the active tab's context; tampered store never reaches the query (`tests/features/disc-nav-01.spec.ts`) | ⏳ written, not run (coordinator) |

### DISC-SESSION-01 (PR 38)
| Case | Status |
| --- | --- |
| CSV: formula guard (`= + - @ \t \r`), RFC 4180 quoting, CRLF, cell formatting by column type, safe file name (jest `src/data/__tests__/sessionActions.test.ts`) | ✅ |
| Share link: codec parameters only (trace hand-off and unknown params dropped), relative by default, epoch ms when absolute; unsaved-changes detection by view / search / filters / columns / sort (jest `sessionActions.test.ts`) | ✅ |
| Alert rule: `$` escaped only inside literals, count query keeps time macros, no time field → no rule, defaults shape (A count, B threshold, condition B, window = range clamped) (jest `sessionActions.test.ts`) | ✅ |
| Share modal + ⋮ menu render, absolute toggle, unsaved warning hidden when a saved search matches, Inspect callback (jest `src/components/__tests__/SessionActions.test.tsx`) | ✅ |
| Share link round trip, absolute toggle, toggle disabled on absolute ranges; CSV download of the current search; Create alert rule prefill; Inspect from ⋮; New session clears the search (`tests/features/disc-session-01.spec.ts`) | written, e2e not run (coordinator) |

### LENS-CHART-01 (PR 41)
| Case | Status |
| --- | --- |
| Pivot: one row per row-bucket value, one column per pivot value × metric, missing combination empty, cap 100; no pivot → unchanged; table panel gets the pivoted frame (jest `chartSpecifics.test.tsx`) | ✅ |
| Summary / colour overrides per (pivot) column, avg → mean, text colouring, no option → no override, exported panel carries them (jest) | ✅ |
| Metric tiles: per breakdown value, secondary metric, progress against maximum (0 max → no bar, capped 100 %), value format, empty → dash, rendered progressbar (jest) | ✅ |
| Groups / add to Maximum value / add to Split metrics by / switchChart drops roles / display-only options keep the query shape / URL round-trip and hostile values dropped (jest) | ✅ |
| Table pivot on the fixture (error column, payments errors, one row per service); summary Sum footer = total and colour by value without a re-query; Metric tiles with secondary + progress (payments ≈ 17 %); Maximum value add + switch to Bar; hostile link values dropped (`tests/features/lens-chart-01.spec.ts`) | e2e not run (coordinator) |
| Metric chart switch now renders `data-panel="tiles"` (`lens-type-01.spec.ts` updated) | e2e not run (coordinator) |

### LENS-STYLE-01 (PR 41)
| Case | Status |
| --- | --- |
| `cleanStyle`: known keys only, bad values / inverted or non-finite bounds / long titles / mismatched legend alignment dropped; URL codec round-trip; hostile style dropped (jest `style.test.tsx`) | ✅ |
| Display-only: `queryShape` drops style; XY chart switches keep it, Table drops it (jest) | ✅ |
| Scales: value domains (full / data / custom / log / percentage), log and sqrt positions, ticks (jest) | ✅ |
| XyChart: auto titles, Auto legend, horizontal geometry, bar values, titles / ticks off, log ticks, custom bounds, legend right / inside / grid / hidden (jest) | ✅ |
| StylePanel: changes through `cleanStyle`, horizontal relabels the axes, Data bounds disabled for bars, Back, bounds order and junk not applied (jest) | ✅ |
| Dashboard export: barchart orientation / values / rotation / legend, axis label / gridlines / log / min / max (jest) | ✅ |
| E2E (`tests/features/lens-style-01.spec.ts`): horizontal + bar values kept in the URL with no new query and across reload, Back; custom / none axis title, log scale, custom bounds and refused inverted range; legend auto / show / right / inside corner / grid / hide; hostile shared style | not run (coordinator) |

### LENS-LAYER-01 (PR 42)
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

### SHARED-A11Y-01 (PR 42)
| Case | Status |
| --- | --- |
| Audit: custom popovers (field, Add / Edit filter, pill menu, bucket actions, histogram legend, cell Expand, Breakdown picker, legend ⋮ menu, dimension editor) | fixed: dialog / menu roles, hint, Escape, focus in and back |
| Audit: Grafana Modal / Drawer / Dropdown / Combobox (Save, Share, Inspector, Query menu, session actions, tab menus, filter chooser) | already OK (Grafana built-in) |
| Audit: Grafana Toggletip (Display options, field type filter) | Escape / focus already OK; role dialog + hint added |
| Audit: Chart type switcher (custom listbox), formula editor suggestions, KQL suggestions | already OK (listbox / combobox, Escape) |
| Audit: grid arrows, Home / End, Ctrl+Home / End, PgUp / PgDn, Enter, Shift+Enter, Esc (DISC-TABLE-01) | already OK; `aria-activedescendant`, sort button, `aria-sort`, named column actions added |
| Audit: drag and drop (Discover field → grid, column reorder, tab reorder; Visualize field → workspace / group) | Discover: button alternatives already present (actions now visible on focus); Visualize: keyboard drag mode added |
| Audit: icon-only buttons / unlabeled inputs | buttons all named; 5 inputs labeled (KQL bar, SQL editor, rows per page, detail search, data view search) |
| `usePopoverDialog`: role / description, focus in, Escape inside and from the page, ignores a used Escape, focus back, keeps user-moved focus; `moveMenuFocus` (jest `src/components/a11y/__tests__/a11y.test.tsx`) | ✅ |
| Pill menu menuitems, arrows, Escape / Tab back to the pill; Edit filter dialog back to the pill; Add filter dialog back to the trigger (jest) | ✅ |
| Field `Preview log.level: string` opens the field dialog, Escape returns focus; row action names (jest) | ✅ |
| Grid `aria-activedescendant` follows the cursor; sort button + `aria-sort`; `Move X left/right`, `Remove column X`; Expand / bucket / Toggletip dialogs carry the hint (jest) | ✅ |
| Keyboard drag: lift / move / drop / cancel / blur, spoken messages, Escape does not reach the page (jest `src/lens/__tests__/a11y.test.tsx`) | ✅ |
| Legend ⋮ menu focus / arrows / Escape back to ⋮; dimension editor Escape closes, page Escape does not, focus to the dimension (jest) | ✅ |
| E2E (`tests/features/shared-a11y-01.spec.ts`): field Preview + Escape focus return; pill menu arrows / Escape / Edit filter dialog; Add filter dialog; grid active descendant + Expand; Display options; Visualize keyboard drag to the workspace and to Breakdown with live messages, editor Escape back to the dimension, cancel; legend ⋮ menu | not run (coordinator) |
| E2E selector updates: `LogsPage.pillAction` and `disc-doc-02` pick pill menu items by role `menuitem` (were `button`) | not run (coordinator) |

### COMPARE-FIXES (PR 43)
| Case | Status |
| --- | --- |
| Parking: Bar over time → Metric → Bar restores the same date histogram and breakdown; Metric → Pie → Line; time field dropped on Metric returns to Bar with the parked date; from-scratch Metric + time field → line; time field on a bucket slot → date histogram; not in `queryShape`; URL round-trip; hostile / oversize parked input; `sanitizeLens` (jest `parked.test.ts`) | ✅ |
| Layers park on Table and come back on Bar (jest `layers.test.tsx`, updated) | ✅ |
| Edit in Visualize: exported target carries the source; path has chart, query, filters, view, dashboard time (relative and absolute); hidden without a source / without a chart; unknown params dropped, oversize refused, path stays under the plugin route (jest `panelSource.test.ts`) | ✅ |
| Default time range: relative / absolute kept; missing, junk, inverted, oversize, injection-shaped fall back to the last hour; resolves to a TimeRange (jest `defaultTimeRange.test.ts`) | ✅ |
| E2E `tests/features/lens-save-02.spec.ts`: save to a new dashboard → panel menu → Extensions → Edit in Visualize reopens the chart with query and view; a plain panel has no item | ✅ |
| E2E `lens-dataview.spec.ts` updated: the active table is asserted on the picker's tooltip | full run |

### PARITY-HISTOGRAM (PR 49)
| Case | Status |
| --- | --- |
| Brush: exact times (4.8 h → 14.4 h), drag order, drag inside one bucket (from < to), whole-second rounding, zero-width → one pixel / one second, clamp at the chart edges, no bars (jest `src/components/__tests__/parityHistogram.test.tsx`) | ✅ |
| VolumeHistogram: drag calls `onSelectRange` with exact times; a short drag in one bucket is non-empty; click zooms to the bucket start → end; partial bands only at partial edges; two-line axis row height (jest `parityHistogram.test.tsx`) | ✅ |
| Inclusive end: bucket at `to` kept, total 41 = SQL count; no empty filler at the end (jest `parityHistogram.test.tsx`; existing `histogramInterval.test.ts` unchanged and green) | ✅ |
| Auto 7 d → 3 h, 24 h → 30 min; Minute on 7 d → `Minute, scaled to 15 minutes`; Second on 1 h → 10 s; Hour on 90 d → 3 h (multiple of the unit, ≤ 1,000) (jest `parityHistogram.test.tsx`) | ✅ |
| Ticks: 7 d → `1st … 8th` + `January 2026`, narrow → every 2 days, 4 h → 30-min ticks with one date line, midnight date line, unround start, multi-year `Jan 2026`, no overlaps (jest `parityHistogram.test.tsx`) | ✅ |
| URL: `refresh` round-trip, junk / too-fast / injection-shaped values read as paused; `resolveBreakdownField` exact / bare column / unknown; malformed `bd` never decodes (jest `src/data/__tests__/urlState.parity.test.ts`) | ✅ |
| E2E `tests/features/parity-histogram.spec.ts`: exact brush + re-bucket + partial band; brush inside one bucket has rows; 08:00–12:00 = 2,161 rows with one partial bucket and the field popover agreeing; auto-refresh off by default, `refresh=1m` kept, junk dropped; 7 d = Auto 3 hours with `1st … 7th` / `January 2026` and non-overlapping ticks; Minute on 7 d scaled with notice and Second selectable; axis clear of the caption with 0 rows and with the detail panel open; default `No breakdown`, explicit `bd` wins; `bd=field:ServiceName` normalised, unknown / junk `bd` dropped | not run (coordinator) |
| Visualize auto interval follows the shared steps: 7 d → 3 h (jest `src/lens/__tests__/compile.test.ts`, `metricOptions.test.ts` Normalize by unit, updated) | ✅ |
| E2E updated for inclusive end (one-day window 5,760 → 5,761): `disc-chart-01.spec.ts` (Filter by time), `disc-time-01.spec.ts` (ISO range link), `integration/it-c-d-time.spec.ts` (IT-D Filter by time) | not run (coordinator) |

### PARITY-GRID (PR 49)
| Case | Status |
| --- | --- |
| Jest | `src/pages/__tests__/parity_grid.test.ts` (doc navigation targets, width reducer / sanitizer / URL round trip, explicit sort, duplicate Body, ISO time, single-doc URL + SQL + hostile anchors, filter hand-back), `src/components/__tests__/parityGrid.test.tsx` (header menu, resize handles, anchor marker, focus return, panel Escape / ←/→ / focus / ISO JSON / single document / dot wrapping, popover buttons + caption + back link, "shown as Message"), `build_logs_query.test.ts` (tie-break), `FieldKeysPopover.test.tsx` (one-click add, caption), `a11y.test.tsx` (header menu) |
| E2E | `tests/features/parity-grid.spec.ts` — not run (coordinator) |
| E2E | `tests/features/disc-doc-01.spec.ts` (First / Last log names) — not run (coordinator) |
| IT-F | Column widths travel with `cols` (URL); resize doesn't re-query — e2e `parity-grid.spec.ts` "columns resize …" not run (coordinator) |
| IT-I | Context view Add filter + anchor highlight — e2e `parity-grid.spec.ts` "surrounding documents …" not run (coordinator) |

### PARITY-DASHBOARDS (PR 49)
| Case | Status |
| --- | --- |
| Save and return | jest `src/lens/__tests__/parityDashboards.test.ts` (return context validation, hostile uids / ids / times, replace in place incl. rows, no-overwrite save, return path), `src/components/__tests__/ParityDashboards.test.tsx` (dialog keeps panel title, version conflict message, Save as new, toolbar Cancel / disabled when the panel is gone); e2e `tests/features/parity-dashboards.spec.ts` "Save and return replaces the panel in place…", "Cancel goes back…", "reports a concurrent change…" — not run (coordinator); `tests/features/lens-save-02.spec.ts` (link carries `dash` / `panel`) — not run (coordinator) |
| Discover → dashboard | jest `src/data/__tests__/parityDashboards.test.ts` (columns / names / order, Open in Discover source and path, `$` escaping, dashboard time, legend), `ParityDashboards.test.tsx` (titles, time, duplicate title, name conflict); e2e `parity-dashboards.spec.ts` "Discover → Add to dashboard…", "duplicate dashboard title…" — not run (coordinator) |
| Lens export legends / empty buckets | jest `parityDashboards.test.ts` (overrides, WITH FILL SQL, no fill when off / non-count / unbound), `save.test.ts`, `metricOptions.test.ts` updated; e2e "split series are named by value" — not run (coordinator) |
| Share / short links | jest `src/data/__tests__/parityDashboards.test.ts` (relative path, response validation, fallback), `src/components/__tests__/SessionActions.test.tsx` (short link by default); e2e `parity-dashboards.spec.ts` "Visualize Share: short link…", `tests/features/disc-session-01.spec.ts` updated (short link by default, switches by id) — not run (coordinator) |
| Saved searches button | jest `ParityDashboards.test.tsx`; e2e `parity-dashboards.spec.ts` "Saved searches menu button…" — not run (coordinator) |

### PARITY-XYCHART (PR 49)
| Case | Status |
| --- | --- |
| LENS-XY-01 | jest `src/lens/__tests__/parityXy.test.tsx`: tooltip rows / separators / highlight / hide on leave, keyboard focus tooltip, no native titles; line unstacked for stacked + percentage, old URL decode, `chartTitle`, `panelSpec` / export stacking; brush from a bar + swallowed click, click without movement; `assignColorSlots` determinism / distinctness / lone value; colour kept after filter and reorder; `orderSeries` count / alpha / asc, Other last; nice ticks 0–140 by 20, integer ticks; `formatNumber` / `formatAxisNumber`; `timeTicks` hourly / 3-hourly across midnight / days; chart time ticks, no auto title, partial buckets; hidden line points; legend colour menu set / reset; `cleanStyle` colours (invalid, cap, long key, `__proto__`), `queryShape` strips, decode round trip; `toHex` |
| LENS-XY-01 | jest updated: `style.test.tsx` (domains / ticks), `layers.test.tsx` (`1,000`), `compile.test.ts` (series order), `ChartTypeSwitcher.test.tsx` (no sub-type for Line)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| LENS-XY-01 | e2e `tests/features/parity-xychart.spec.ts` (tooltip, keyboard tooltip, legend order across types, Line sub-type + old link, brush from a bar + click, stable colour after filter, value ticks, time axis / partial / plain lines, no blank frame on switch, legend colour picker): not run (coordinator)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| IT-LENS    | e2e updated for the number format (`9.3K` → `9,264`, `1.6K` → `1,575`): `lens-interact-01`, `lens-interact-02`, `lens-dataview`, `lens-save-01`, `lens-style-01` (bar value, custom bound tick `20,000`), `lens-dim-05` (Filters count): not run (coordinator)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
