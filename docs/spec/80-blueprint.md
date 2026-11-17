## Plugin implementation blueprint

Extend the existing **ClickHouse Observe** app plugin ([PoorTuna/clickhouse-observe-grafana](https://github.com/PoorTuna/clickhouse-observe-grafana), v0.10.0, \~28k lines of TypeScript, 52 test files) instead of starting a new one. It already implements most of Discover on ClickHouse; the remaining work is Lens, a few Discover gaps, and a refactor so Discover and Lens share one search context.

### Starting point: what the existing plugin covers

Status comes from reading the v0.10.0 code and README, not from running it; Phase 0 verifies it.

| Spec ID | Existing implementation | Status | Work left |
| --- | --- | --- | --- |
| SHARED-STATE-01/02 | `LogsQueryState` + reducer (`src/pages/_logsQueryReducer.ts`), URL encode/decode (`src/data/urlState.ts`) | Partial | Extract into a shared search-context store used by Discover and Lens; add pinned filters and cross-page URL state |
| DISC-SEARCH-02, SHARED-AUTOCOMPLETE-01 | KQL lexer, parser, KQL→SQL and suggestions (`src/sql/kql/`), `SearchBar.tsx`, with tests; suggests fields, operators, live top values, Map sub-keys | Done for the query bar | Reuse the suggestion service in Lens field pickers and the formula editor; run the autocomplete checklist on every input |
| DISC-FILTER-01/02 | `FilterPills.tsx`, `AddFilter/FilterEditForm.tsx`; edit, exclude, disable; 8 operators incl. contains; custom labels | Done | Pin across pages |
| DISC-SIDEBAR-01 | `FieldSidebar/`, `FieldsContext.tsx`; `system.columns` + Map/JSON key discovery; empty-fields split; Kibana type colours | Done | Optional Popular fields group |
| DISC-SIDEBAR-02 | `FieldSidebar/FieldStatsPopover.tsx`: top values with %, add as column | Mostly | Add Visualize → Lens, add-as-breakdown icon, numeric distribution toggle, sample-size footer |
| DISC-CHART-01/02 | `VolumeHistogram.tsx` (custom-drawn), `HistogramControls/BreakdownPicker.tsx`; intervals, top-10 + Other breakdown, drag to zoom | Done | Right-click pinned-tooltip actions; Edit visualization → Lens |
| DISC-TABLE-01/02/03 | `LogsTable.tsx`: sortable, reorderable columns; hover toolbar filter for / out / copy | Done | Route actions through the shared action registry |
| DISC-DOC-01 | `LogDetailDrawer.tsx`: all fields, filter for / out, trace-ID link | Done | Pin field, prev/next (verify) |
| DISC-DOC-02 | `buildSurroundingDocsQuery` in `src/sql/queryBuilder.ts` | Partial | Context view UI: disabled filters, highlighted anchor, Load N newer/older |
| LENS-INSPECT-01 | `Diagnostics/` drawer with timing waterfall | Exceeds spec | Reuse for Lens |
| DISC-SESSION-01 | Saved searches (browser localStorage), shareable URLs, `AddToDashboard/AddToDashboardModal.tsx` | Done | Reuse the modal for Lens save |
| DISC-PATTERNS-01, DISC-FIELDSTATS-01, DISC-NAV-01 | — | Missing | Phases 2 and 4 |
| All LENS-\* | — | Missing | Phase 3 |

### Architecture decisions

- **Frontend-only.** Keep querying through `grafana-clickhouse-datasource` (`src/data/runQuery.ts`); the repo removed its Go backend in 0.4.7. Add a backend only if Patterns needs server-side clustering.
- **Plain React + `@grafana/ui`.** No migration to Scenes; it would cost more than it returns.
- **Lens renders with Grafana's own visualizations** through `PanelRenderer` from `@grafana/runtime` (time series, bar chart, stat, table, pie, heatmap). Lens state compiles to ClickHouse SQL; the resulting data frame feeds the panel. No new chart library.
- **One action registry** (`src/actions/`) called by the table, detail drawer, field popover, histogram and Lens charts, so filter-for/out/copy/visualize behave identically everywhere.
- **Repo rules stay in force:** never edit `.config/`, never change plugin ID or type, build with the provided webpack config, write E2E with `@grafana/plugin-e2e`, restart Grafana after any `plugin.json` change.
- **AI column guess** calls a configurable model endpoint from the browser; keep it optional and off by default for deployments where external AI is not allowed.

### Proposed module additions

```
src/
├─ state/searchContext.ts     SHARED-STATE-01/02 (extracted from the LogsExplorer reducer + urlState)
├─ actions/registry.ts         SHARED-ACTION-01
├─ autocomplete/service.ts     SHARED-AUTOCOMPLETE-01 (wraps src/sql/kql/suggest.ts)
├─ pages/LogsExplorer.tsx      existing Discover page, slimmed to use the shared store
├─ pages/ContextView.tsx       DISC-DOC-02
├─ components/FieldStatsTab/   DISC-FIELDSTATS-01
├─ components/Patterns/        DISC-PATTERNS-01
└─ lens/
   ├─ state.ts                 LensState, Dimension
   ├─ suggest.ts               suggestion engine + chart-switch remapping (LENS-AUTO-01, LENS-TYPE-01)
   ├─ compile.ts               LensState → ClickHouse SQL
   ├─ LensPage.tsx             new app page (new plugin.json include)
   ├─ Workspace.tsx            PanelRenderer + Select filters to apply chooser
   └─ ConfigPanel/, DimensionEditor/, FormulaEditor/
```

### Core TypeScript interfaces

Extend the existing types in `src/types.ts` (`LogsQueryState`, `FilterPill`, `SelectedColumn`, `DataView`) rather than duplicating them; the interfaces below describe what must be added.

```typescript
// Reuse SearchContext and Filter from SHARED-STATE-01.

interface FieldSpec {
  name: string;
  type: 'keyword' | 'text' | 'number' | 'date' | 'ip' | 'geo_point' | 'boolean';
  aggregatable: boolean;
  searchable: boolean;
  description?: string;          // ECS description shown in popover
  existsInRange?: boolean;       // drives Available vs Empty
  popularity: number;            // drives Popular fields
}

interface FieldStatsResult {
  field: string;
  sampleSize: number;            // 5000
  totalDocs: number;
  docsWithValue: number;
  distinctCount?: number;
  topValues?: { value: string | number; count: number; percent: number }[];
  otherPercent?: number;
  min?: number; max?: number; median?: number;
  histogram?: { from: number; to: number; count: number }[];   // 10 buckets
  timeDistribution?: { ts: number; count: number }[];
  examples?: string[];           // text / geo
}

interface PatternRow {
  key: string;                   // category key
  count: number;
  tokens: string[];
  regex: string;
  examples: string[];            // 4
  sparkline: { ts: number; count: number }[];
}

interface Dimension {
  id: string;
  operation: 'count' | 'avg' | 'sum' | 'min' | 'max' | 'median' | 'percentile' | 'unique_count'
           | 'last_value' | 'cumulative_sum' | 'differences' | 'moving_average' | 'counter_rate'
           | 'formula' | 'date_histogram' | 'terms' | 'filters' | 'range';
  field?: string;
  params?: { size?: number; orderBy?: 'count' | 'alpha' | 'rare' | 'significant' | string;
             orderDir?: 'asc' | 'desc'; otherBucket?: boolean; missingBucket?: boolean;
             interval?: string; percentile?: number; formula?: string };
  filter?: { language: 'kuery'; query: string };
  timeShift?: string;            // '1d', '1w'
  label?: string; format?: 'number' | 'percent' | 'bytes' | 'bits' | 'duration';
  color?: string; axisSide?: 'left' | 'right' | 'auto';
}

interface LensState {
  chartType: 'bar' | 'line' | 'area' | 'metric' | 'table' | 'pie' | 'gauge' | 'heatmap'
           | 'treemap' | 'waffle' | 'mosaic' | 'tagcloud';
  subType?: 'stacked' | 'percentage' | 'unstacked';
  layers: { id: string; dataset: string; type: 'data' | 'annotations' | 'referenceLine';
            groups: Record<string, string[]>;   // role → dimension ids
            dimensions: Record<string, Dimension> }[];
}

interface Suggestion { title: string; score: number; state: LensState; preview?: 'icon' | 'thumbnail' }
```

### Suggestion engine (implements LENS-AUTO-01)

1. Classify each dimension as bucket-date, bucket-terms or metric.
2. Generate candidates per chart type whose roles can hold those dimensions; score by fit: date bucket → Line highest; one terms bucket + metric → Bar highest; no bucket → Metric; two terms buckets → Bar with breakdown, then Heat map, Treemap, Mosaic.
3. New number field → `median`; `Records` → `count`; new keyword → `terms(size 9, order count desc)`; if the dataset has a time field and no bucket exists, add `date_histogram(auto)` on X.
4. Always add a single-metric candidate and a flipped candidate (swap X and breakdown).
5. On chart-type switch, map existing dimensions to the new roles in order; drop extras the target cannot hold.

### Query layer (ClickHouse SQL, through the datasource)

| Feature | Query | Exists? |
| --- | --- | --- |
| Field list | `system.columns` + Map/JSON key introspection (`src/sql/introspection.ts`) | Yes |
| Field stats popover / tab | Over a sampled subquery (`LIMIT 5000` or `SAMPLE`): `count()`, `uniq(x)`, top values `GROUP BY x ORDER BY count() DESC LIMIT 10`; numbers add `min`, `max`, `quantile(0.5)(x)`, `histogram(10)(x)` | Top values yes; numeric stats to add |
| Hits + histogram | `buildLogsQuery`; volume with `toStartOfInterval` and top-10 + Other via `GLOBAL IN` | Yes |
| Surrounding documents | `buildSurroundingDocsQuery`: `ts <= anchor ORDER BY ts DESC LIMIT n` and `ts >= anchor ORDER BY ts ASC LIMIT n`, filters ignored | Query yes, UI no |
| Patterns, v1 | Normalise the message (`replaceRegexpAll` for hex IDs, UUIDs, numbers, IPs) into a template, then `GROUP BY template ORDER BY count() DESC LIMIT 50` with `any(body)` examples and a per-bucket sparkline, on a sampled subquery | No |
| Patterns, v2 (only if v1 is too coarse) | Drain-style clustering in a web worker over a \~10k-row sample | No |
| Lens chart | Compile dimensions: date histogram → `toStartOfInterval`; top values → `GROUP BY … LIMIT 9` (+ Other); median/percentile → `quantile(p)(x)`; unique count → `uniq(x)`; per-metric filter → `countIf(<KQL→SQL>)`; time shift → second query on the shifted range joined by bucket; counter rate → window function | No |
| Value suggestions | Existing `src/sql/kql/suggest.ts` top-values lookup | Yes |

### Grafana APIs to use

- `@grafana/runtime`: `PanelRenderer` (Lens charts), `getDataSourceSrv`, `getBackendSrv`, `locationService` (Discover ↔ Lens navigation).
- `@grafana/data`: `DataFrame`, `FieldType`, value formats.
- `@grafana/ui`: existing components (`Button`, `Combobox`, `Drawer`, `Modal`, `Tooltip`) to match Grafana's look.
- `plugin.json`: a new `includes` page for Lens; the existing `extensions.addedLinks` trace-view link stays.

### Work plan

1. **Phase 0 — Baseline** (Opus). Run `npm ci`, `typecheck`, `lint`, `test:ci`, `build` and `e2e` exactly as CI does; start `docker compose up` with OTel-style seed data; verify the Starting point table against the running app; add the spec to `docs/spec/` (one file per section) and extend `CLAUDE.md` with spec conventions and the definition of done below.
2. **Phase 1 — Shared foundations** (Opus, one at a time). Extract the search-context store from `LogsExplorer.tsx` with no behaviour change (all tests green before and after); add the action registry and route the table, drawer and popover through it; wrap the KQL suggestion code as the shared autocomplete service.
3. **Phase 2 — Discover gaps** (Sonnet, parallel worktrees, Opus review). Visualize button and histogram Edit visualization (pointing to a stub Lens route); popover additions; surrounding-documents UI; Field statistics tab.
4. **Phase 3 — Lens** (Opus for `state`, `compile`, `suggest`; Sonnet for the UI). Unit-test `compile.ts` against the local ClickHouse; build the Lens page with `PanelRenderer`; dimension editors; one-menu chart switching; click-to-filter chooser; Explore in Discover; save to dashboard via the existing modal.
5. **Phase 4 — Patterns** (Opus; Fable only if clustering quality is poor). Ship v1 SQL templates, check them on real logs, build v2 only if needed.
6. **Phase 5 — Polish.** Session tabs, optional panel plugins, README and CHANGELOG.

### Development skills and practices

| Skill or practice | Source | When to use |
| --- | --- | --- |
| Grafana plugin instructions (`.config/AGENTS/instructions.md`, loaded via `CLAUDE.md`) | Repo | Always. Fetch current Grafana docs from `grafana.com/developers/plugin-tools/llms.txt` instead of relying on memory; obey the `.config` rules |
| `/build-plugin` | Repo (`.claude/skills`) | After each feature, to build with the provided webpack config |
| `/validate-plugin` | Repo (`.claude/skills`) | End of each phase and before release; runs Grafana's plugin validator |
| E2E guide (`.config/AGENTS/e2e-testing.md`) | Repo | Every E2E test: `@grafana/plugin-e2e` fixtures and selectors; one test per FLOW in this spec |
| Plan mode | Claude Code | Start of every feature session: restate the spec ID's acceptance criteria and the file plan before editing |
| Explore and Plan subagents | Claude Code | Explore to find code in the 28k-line repo without filling context; Plan for the Phase 1 refactor and the Lens compiler design |
| `/code-review` | Claude Code | Before every PR; `--fix` for small findings |
| `/simplify` | Claude Code | After tests pass, especially while slimming `LogsExplorer.tsx` |
| `/security-review` | Claude Code | Any change to KQL→SQL, filter→SQL or the Lens compiler (SQL injection risk; the repo fixed one in 0.4.10) |
| Git worktrees | Claude Code | Parallel Phase 2 features |
| Hooks (set up with `/update-config`) | Claude Code | Run `typecheck` and `lint` after edits and jest on touched files |
| `skill-creator` | Claude Code | Create two project skills: `implement-spec-feature` (load spec ID → tests from acceptance criteria → implement → build, test, e2e → checklists) and `clickhouse-sql-check` (run generated SQL against the local ClickHouse and compare results) |
| `/fewer-permission-prompts` | Claude Code | After the first sessions, to allow-list repeated read-only commands |

**Definition of done for every feature**

- [ ] The spec ID's acceptance criteria exist as jest and/or `@grafana/plugin-e2e` tests.
- [ ] `typecheck`, `lint`, `test:ci` and `build` pass, as in CI.
- [ ] The SHARED-AUTOCOMPLETE-01 checklist passes for every new input.
- [ ] `/code-review` is clean; `/security-review` ran if SQL generation changed.
- [ ] CHANGELOG entry and version bump, following the repo's `feat: …; bump to x.y.z` convention.
