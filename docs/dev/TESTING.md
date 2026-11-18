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
