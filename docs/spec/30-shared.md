## Shared and cross-cutting specs

One serialisable search context — data source, query, filters, time range, refresh — is owned by a shared service and mirrored into the URL, so every view reads and writes the same object. This is what makes drilldowns feel seamless.

### SHARED-STATE-01 Search context model

```typescript
interface SearchContext {
  dataSource: { type: 'dataView'; dataViewId: string } | { type: 'esql' };
  query: { language: 'kuery' | 'lucene'; query: string } | { esql: string };
  filters: Filter[];            // app-scoped (_a)
  pinnedFilters: Filter[];      // global (_g), follow the user across apps
  time: { from: string; to: string };  // 'now-7d' or ISO
  refreshInterval: { pause: boolean; value: number }; // ms
}

interface Filter {
  meta: {
    key: string;                // field name
    type: 'phrase' | 'phrases' | 'range' | 'exists' | 'custom';
    params: unknown;            // {query:'error'} | ['a','b'] | {gte,lt}
    negate: boolean;            // Exclude results
    disabled: boolean;          // Temporarily disable
    alias: string | null;       // Custom label
    index: string;              // data view id
  };
  query: object;                // compiled DSL, e.g. {match_phrase:{'log.level':'error'}}
  $state: { store: 'appState' | 'globalState' };
}

interface DiscoverAppState {
  columns: string[];
  sort: [field: string, dir: 'asc' | 'desc'][];
  interval: 'auto' | 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';
  breakdownField?: string;
  viewMode: 'documents' | 'patterns' | 'field_statistics';
  sampleSize: number;           // default 500
  rowHeight: number;            // body cell lines, default 3
}
```

### SHARED-STATE-02 URL schema

State is encoded with Rison in two hash parameters plus a tab id. Observed example after adding a filter from the field popover:

```
/app/discover#/?
  _a=(dataSource:(dataViewId:logs-app-default,type:dataView),
      filters:!((meta:(key:log.level,negate:!f,disabled:!f,params:(query:error),type:phrase),
                 query:(match_phrase:(log.level:error)),$state:(store:appState))),
      interval:auto, query:(language:kuery,query:''), sort:!(!('@timestamp',desc)))
  &_g=(filters:!(), refreshInterval:(pause:!t,value:60000), time:(from:now-7d,to:now))
  &_tab=(tabId:c87b08a7-…)
```

Rules: `_g` carries time, refresh and pinned filters across apps; `_a` is per app. Brushing writes ISO strings into `_g.time`. Context view uses a path route `#/context/<dataViewId>/<docId>` with the same `_a`/`_g`.

### SHARED-STATE-03 Propagation between views

| From | Action | To | What is carried |
| --- | --- | --- | --- |
| Discover field popover | Visualize | Lens (same tab) | data view, query, filters, time; field becomes the chart |
| Discover histogram | Edit visualization | Lens | the histogram's dimensions + breakdown |
| Field statistics row | 📊 action | Lens | field as chart |
| Lens | Explore in Discover | Discover (new browser tab) | data view, query, filters, time; bucket fields → columns |
| Lens / Discover | Save to dashboard | Dashboard | panel + its own query; dashboard query and filters are added on top |
| Doc flyout | View surrounding documents | Context route | columns; filters carried but disabled; query dropped |
| Any chart value | Click / legend Filter for | same view | new filter pill (app scope) |

### SHARED-ACTION-01 Trigger and action registry

Kibana routes all interactions through a registry: a **trigger** fires with a **context**, and every registered **action** whose `isCompatible(context)` returns true is offered. One action shows directly; several show as a context menu. This is why the same “Filter for / Filter out / Copy” appear in tables, charts, legends and flyouts.

```typescript
type TriggerId = 'VALUE_CLICK' | 'SELECT_RANGE' | 'MULTI_VALUE_CLICK' | 'CELL_VALUE' | 'ROW_CLICK' | 'FIELD_CLICK';

interface ValueClickContext {
  data: { table: DataFrame; column: number; row: number; value: unknown }[];
  negate?: boolean;
  timeFieldName?: string;
}

interface Action<C> {
  id: string;                    // 'ACTION_FILTER_FOR', 'ACTION_COPY', 'ACTION_EXPLORE_IN_DISCOVER'
  order: number;
  getDisplayName(ctx: C): string;
  getIconType(ctx: C): string;
  isCompatible(ctx: C): Promise<boolean>;
  execute(ctx: C): Promise<void>;
}
```

Behaviour rules observed: VALUE\_CLICK with more than one dimension shows the `Select filters to apply` chooser; SELECT\_RANGE on a time axis sets the global time; legend actions reuse VALUE\_CLICK with a single datum.

### SHARED-PERF-01 Responsiveness and honesty cues

- Global thin loading bar under the header; per-panel spinners; Refresh shows `Update` when stale.
- `Send to background` turns a slow search into a stored background search (overflow → Background searches).
- Sampling is always labelled: `Calculated from 5,000 sample records.`, `Probability used: 30%`.
- ES|QL status line reports time, documents processed, warnings and errors.

### SHARED-A11Y-01 Keyboard and accessibility

- Every popover announces “You are in a dialog. Press Escape…”. Grids implement full arrow-key navigation (see DISC-TABLE-01).
- Drag and drop has a keyboard mode with spoken instructions.
- Field buttons have aria-labels such as `Preview log.level: string` and `Add log.level to workspace`.

### SHARED-AUTOCOMPLETE-01 Autocomplete everywhere (principle)

- **Purpose:** the user never has to know the schema, the exact values or the function syntax; the UI offers them at the point of typing. This applies to every feature, and each feature PR must be checked against the checklist below.
- **Observed surfaces in Kibana:**

| Surface | What is suggested | Source of suggestions | Spec |
| --- | --- | --- | --- |
| KQL query bar | Field names with type icon after a prefix (`serv` → `service.environment`, `service.name`, `service.name.text`, `service.version`); real values, quoted, after ` field :  ` (`"auth"`, `"checkout"`…) | Field list; terms lookup scoped to the time range | DISC-SEARCH-02 |
| Filter editor | Searchable field combobox with type icons; value combobox after an operator is chosen; operator list depends on field type | Field metadata; terms lookup | DISC-FILTER-02 |
| Field sidebar search | Field names filtered as you type, plus type filter with counts | Field list | DISC-SIDEBAR-01 |
| Breakdown selector, Lens Field combobox | Only fields valid for the context (aggregatable for breakdown, numeric for Average/Percentile) | Field metadata | DISC-CHART-02, LENS-DIM-02 |
| Lens formula editor | Functions with full signature (`count([field], [kql]?, [lucene]?, [shift]?, [reducedTimeRange]?)`), description popover, fields as arguments, auto-closed brackets, inline error count | Function registry + field list | LENS-DIM-03 |
| Chart type switcher | Types filtered as you type (`Metric`) | Static list | LENS-TYPE-01 |
| Document flyout search | Field names or values within the document | The document | DISC-DOC-01 |
| Time picker | Typed shorthand (`-7d`, `td`, `yd`) next to each preset | Static presets | DISC-TIME-01 |

- **Rules to implement:**
  1. Field suggestions always show the field type icon and are filtered to what is valid in that context.
  2. Value suggestions come from real data, scoped to the current time range (and current filters where cheap), and are quoted/escaped for the query syntax.
  3. Suggestions appear while typing with a short debounce and never block input; keyboard: ↑/↓ to move, Enter/Tab to accept, Esc to close.
  4. Accepting a suggestion inserts it and places the cursor ready for the next token (field → `:`, value → space).
  5. Functions show their signature and a one-line description before the user commits.
  6. Mistakes are shown inline at the point of the error while typing, not as a generic error after running the query.
- **Data (ClickHouse):** fields from `DESCRIBE TABLE` / `system.columns`, cached per dataset; values with `SELECT <field>, count() FROM <table> WHERE <time range> AND <field> ILIKE '<prefix>%' GROUP BY <field> ORDER BY count() DESC LIMIT 10`, using `SAMPLE` or a row limit on large tables; for `LowCardinality` or `Enum` columns the distinct set can be served directly.
- **Acceptance checklist (every feature PR):**
  - [ ] Every input that names a field offers field suggestions with types.
  - [ ] Every input that expects a value offers real values from the current time range.
  - [ ] Every input that takes a function shows its signature and description.
  - [ ] Completion works with the keyboard alone.
  - [ ] No free-text field, value or function input exists without suggestions.
- **Grafana mapping:** partial. The ClickHouse query builder offers column dropdowns from the schema and ad-hoc filters suggest keys and values (`getTagKeys` / `getTagValues`), but there are no data-value suggestions while typing a query and no single principle across inputs. Verify against the installed plugin version.
