import { FieldModel } from './sql/fieldModel';

// SourceConfig: persisted in plugin jsonData. Drives all SQL generation.

export interface ColumnMapping {
  timestamp: string;
  body: string;
  severity: string;
  // Trace ID column — powers the "open trace in Explore" link in the log detail drawer.
  traceId: string;
  serviceName: string;
  // Map column — empty string means column absent.
  spanAttributes: string;
  /**
   * Coarse partition/primary-key-member time column used purely for index-pruning predicates
   * (see sql/pruneColumn.ts + queryBuilder.ts's buildWhereConditions) — never used to select or
   * filter data on its own. Inferred: App.tsx fills in what useFieldDiscovery detects from
   * system.columns. No form sets it any more; a value saved by an older version is only a starting
   * point until detection answers (and the fallback where the table reports no keys, e.g. a view),
   * and `'-'` still means off.
   */
  partitionTimestamp: string;
}

export const OTEL_COLUMN_MAPPING: ColumnMapping = {
  timestamp: 'Timestamp',
  body: 'Body',
  severity: 'SeverityText',
  traceId: 'TraceId',
  serviceName: 'ServiceName',
  spanAttributes: 'SpanAttributes',
  partitionTimestamp: '',
};

export const EMPTY_COLUMN_MAPPING: ColumnMapping = {
  timestamp: '',
  body: '',
  severity: '',
  traceId: '',
  serviceName: '',
  spanAttributes: '',
  partitionTimestamp: '',
};

/**
 * How the time field (`columns.timestamp`) is read: `native` (or unset) = a Date / DateTime /
 * DateTime64 column used as is; `epoch_*` = an integer epoch in that unit; `string` = text parsed
 * as a date. Every query reads the field through `timeExpr` (src/sql/timeExpr.ts).
 */
export type TimestampFormat = 'native' | 'epoch_s' | 'epoch_ms' | 'epoch_us' | 'epoch_ns' | 'string';

export interface SourceConfig {
  /** Runtime only (App.tsx): widening of the `columns.partitionTimestamp` predicate, see sql/pruneColumn.ts. */
  pruneWidenSeconds?: number;
  datasourceUid: string;
  database: string;
  logsTable: string;
  /** How `columns.timestamp` is read (see TimestampFormat). Unset = native. */
  timestampFormat?: TimestampFormat;
  // Legacy flag, no longer read by SQL generation — all paths use columns.* mapping.
  // Kept for backwards-compat with persisted jsonData; new views leave it false.
  isOtel: boolean;
  columns: ColumnMapping;
  /**
   * Extra non-core columns this view loads with the grid by default, in display order — e.g.
   * "LogAttributes.http.method". Appended after the fixed core columns (Time/Level/Service/
   * Message), never replaces them; core columns are always emitted regardless of this list (see
   * defaultColumns() in LogsExplorer.tsx). Undefined/empty = today's core-only behavior. Labeled
   * "Pinned columns" in the UI — "pinned" means saved with the view, not position-locked; they
   * remain reorderable/removable in the grid like any manually-added column (isCore: false).
   */
  pinnedColumns?: SelectedColumn[];
  /** Append `select_sequential_consistency = 1` to every query for this view — makes whichever
   *  replica answers catch up from Keeper first, so a round-robin load balancer (e.g. an
   *  OpenShift Route) in front of a multi-replica cluster can't serve a stale or missing read.
   *  Undefined is treated as true (see configSettingsFragments in sql/settings.ts) so views
   *  persisted before this setting existed inherit it. */
  sequentialConsistency?: boolean;
  /** Advanced: extra ClickHouse SETTINGS for this view's queries, comma-separated, e.g.
   *  "max_replica_delay_for_distributed_queries = 30". Overrides builder/sequentialConsistency
   *  defaults on key collision (see sql/settings.ts's withSettings). */
  extraQuerySettings?: string;
  /** Per-view ClickHouse `max_execution_time` budget (seconds) for every query this view issues —
   *  see sql/settings.ts's DEFAULT_QUERY_TIMEOUT_SECONDS and queryTimeoutFragments() for why one
   *  number replaced the old per-query-class spread (60s/15s/10s), and why the default sits below
   *  a typical reverse-proxy's own hard timeout. Undefined = DEFAULT_QUERY_TIMEOUT_SECONDS. */
  queryTimeoutSeconds?: number;
  /** Advanced: cluster name for the diagnostics drawer's server-side enrichment tier (see
   *  diag/serverStats.ts) — when set, the tier reads `system.query_log` via
   *  `clusterAllReplicas(<name>, system.query_log)` instead of the local table, so stats for a
   *  query answered by any replica are found, not just the one this browser happened to hit.
   *  Unset means single-node or non-distributed `system.query_log` reads. Unrelated to the query
   *  builders' own `select_sequential_consistency` — that's about read consistency, this is about
   *  where diagnostics looks for a query's own log row afterward. */
  clusterName?: string;
}

export const DEFAULT_SOURCE_CONFIG: SourceConfig = {
  datasourceUid: '',
  database: 'default',
  logsTable: '',
  isOtel: false,
  columns: EMPTY_COLUMN_MAPPING,
  sequentialConsistency: true,
};

export type FilterOp =
  | '='            // is
  | '!='           // is not
  | 'contains'     // contains
  | 'not_contains' // does not contain
  | 'one_of'       // is one of (IN)
  | 'not_one_of'   // is not one of (NOT IN)
  | 'exists'       // exists
  | 'not_exists'   // does not exist
  | 'gte'          // greater or equal (value)
  | 'lt'           // less than (value)
  | 'between'      // is between (values: [low, high], inclusive)
  | 'not_between'; // is not between (values: [low, high])

/** One leaf condition inside a compound pill (same shape as the single-condition pill fields). */
export interface FilterCondition {
  field: string;
  op: FilterOp;
  value: string;
  values?: string[];
}

/** Conditions combined with OR / AND; items may be leaves or nested groups (depth limited by
 *  MAX_COND_DEPTH in sql/filters.ts). Validated by sanitizeFilterPills. */
export interface FilterCondGroup {
  join: 'or' | 'and';
  items: Array<FilterCondition | FilterCondGroup>;
}

export interface FilterPill {
  /** Disabled by a Discover data view switch: the id of the view it applies to (enabled again there). */
  homeView?: string;
  id: string;
  field: string;
  op: FilterOp;
  value: string;        // single-value ops; '' for multi / exists ops
  values?: string[];    // one_of / not_one_of; [low, high] for between / not_between
  label?: string;       // optional custom display label
  disabled?: boolean;   // temporarily excluded from the query, kept in state/URL
  /** Pinned across app pages (SHARED-STATE-01): kept in per-tab session storage and re-applied on
   *  every page that opens without it, like Kibana's global `_g` filters. */
  pinned?: boolean;
  /** Filter group (one level): pills sharing a `group` id and `groupOp: 'or'` are combined with OR
   *  into one condition; 'and' (or no groupOp) is the plain top-level AND, shown as a group.
   *  Sanitized by sanitizeFilterPills (id charset + operator enum). */
  group?: string;
  groupOp?: 'or' | 'and';
  /** Compound pill: one pill built from several conditions combined with OR / AND, with `field` ''
   *  and `op` '=' as placeholders. Absent on every single-condition pill (backward compatible). */
  cond?: FilterCondGroup;
  /** Negates a compound pill as a whole (`NOT (...)`); single-condition pills negate via `op`. */
  negate?: boolean;
}

export type ColumnType = 'time' | 'level' | 'text' | 'number' | 'string' | 'exact' | 'map' | 'json' | 'tuple' | 'array' | 'unknown';

export interface SelectedColumn {
  id: string;           // stable identifier
  key: string;          // row-object key (alias in SELECT)
  sqlExpr: string;      // SQL expression
  displayName: string;
  type: ColumnType;
  isCore: boolean;      // core cols are always selected; user cols add extra SELECT clauses
  /** Display width in px set by resizing the header (PARITY-GRID); absent = automatic. Display
   *  only: never reaches SQL, clamped by sanitizeColumns when restored from a URL / saved search. */
  width?: number;
}

export interface LogsQueryState {
  search: string;
  filters: FilterPill[];
  rawSql: string;
  useRawSql: boolean;
  limit: number;
  columns: SelectedColumn[];
  sort?: { col: string; dir: 'asc' | 'desc' };
}

/** Histogram time bucket granularity. 'auto' derives the best interval from the time range. */
export type IntervalMode = 'auto' | 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'week' | 'month' | 'year';

/**
 * Histogram breakdown selection.
 * - 'none'     → plain single-color bars; no per-series coloring.
 * - 'severity' → stack by severity column (existing behavior, default when severity is mapped).
 * - 'field'    → top-10 CTE breakdown by a chosen field.
 */
export type BreakdownSel =
  | { kind: 'none' }
  | { kind: 'severity' }
  | { kind: 'field'; field: FieldModel };

export const DEFAULT_LOGS_QUERY_STATE: LogsQueryState = {
  search: '',
  filters: [],
  rawSql: '',
  useRawSql: false,
  limit: 200,
  columns: [],
  sort: undefined,
};

export type LogRow = Record<string, unknown>;

export interface VolumeDataPoint {
  time: number;
  levels: Record<string, number>;
}

/** A named, storable view over a single logs table — superset of SourceConfig. */
export interface DataView extends SourceConfig {
  id: string;
  name: string;
  /** 'shared' = stored in plugin jsonData by admin; 'personal' = localStorage per-browser. */
  origin: 'shared' | 'personal';
  createdAt: string;
}

/**
 * AI provider config for the "Guess with AI" column-mapping assist. Points at any
 * OpenAI-compatible `/chat/completions` endpoint (hosted or self-hosted, e.g. Ollama).
 * NOTE: `token` is stored in plain jsonData (not secureJsonData), so it is readable by any
 * browser user of this plugin — acceptable for local/self-hosted use, NOT a secret store.
 * Do not put a production API key with broad billing access here.
 */
export interface AiProviderConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  token?: string;
}

// Plugin jsonData shape
export interface AppJsonData {
  /** Admin-managed shared data views (v1+). */
  dataViews?: DataView[];
  /** ID of the view that is active by default for all users. */
  defaultDataViewId?: string;
  /** LEGACY single-source config — migrated to a shared DataView on load. */
  sourceConfig?: SourceConfig;
  /** AI column-mapping assist settings, admin-configured. */
  ai?: AiProviderConfig;
  /** Range Discover and Visualize open on when the URL has none (Kibana's timepicker:timeDefaults). */
  defaultTimeRange?: { from: string; to: string };
}

export interface SavedSearch {
  id: string;
  name: string;
  search: string;
  filters: FilterPill[];
  columns: SelectedColumn[];
  sort?: { col: string; dir: 'asc' | 'desc' };
  timeRange?: { from: string; to: string };
  createdAt: string;
  /** Scope this saved search to a specific data view; undefined = legacy (all views). */
  dataViewId?: string;
  /** Free text shown in the list (Kibana's saved-object description). */
  description?: string;
  tags?: string[];
  /** Dashboard uid when stored as a shared Grafana saved object; absent = browser-only. */
  sharedUid?: string;
}
