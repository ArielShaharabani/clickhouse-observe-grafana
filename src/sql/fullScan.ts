/**
 * Budgeted full-time-range lookups (R5-SAMPLING, user item 15).
 *
 * Autocomplete samples the 500 newest rows and field statistics the 5,000 newest, so a rare value
 * outside that window never shows up. Two opt-in paths read the whole time range instead, each
 * under a hard read budget so a 50M-row table can't turn a keystroke or a click into a long scan:
 *
 * - value autocomplete, once a value prefix is typed: `toString(expr) ILIKE 'prefix%'` over the
 *   whole range (`buildPrefixValuesQuery`);
 * - field statistics, on "Scan full range": the same profile as the sampled batch, over every row
 *   (`buildFieldStatsFullScanQuery` in fieldStats.ts).
 *
 * Unlike every other builder in this plugin, these deliberately use `'break'` overflow modes: the
 * result is labelled as budgeted (autocomplete merges it with the sample; the stats caption says
 * whether the scan was complete or partial) instead of failing. Measured on CH 26.3 against
 * perf_logs_50m: `read_overflow_mode = 'break'` returns the aggregate over the rows read so far,
 * but `timeout_overflow_mode = 'break'` returns ZERO rows for an aggregate (with or without GROUP
 * BY) — so a time-limit hit is detectable (an aggregate without GROUP BY always returns one row
 * otherwise), and the row cap is what yields a useful partial result.
 */
import { SourceConfig } from '../types';
import { escapeLike, quoteString, tableRef } from './queryBuilder';
import { configSettingsFragments, DEFAULT_QUERY_TIMEOUT_SECONDS, withSettings } from './settings';

export interface ScanBudget {
  /** Wall-clock cap (ClickHouse `max_execution_time`, `timeout_overflow_mode = 'break'`). */
  maxSeconds: number;
  /** Rows-read cap (ClickHouse `max_rows_to_read`, `read_overflow_mode = 'break'`). */
  maxRows: number;
}

/** Autocomplete prefix lookup: runs per (debounced) keystroke, so the tightest budget. */
export const PREFIX_LOOKUP_BUDGET: ScanBudget = { maxSeconds: 2, maxRows: 20_000_000 };

/** "Scan full range" field statistics: an explicit click, so a longer wall clock than the
 *  keystroke path (a Map-value column alone needs ~4 s for 20M rows on the perf fixture, and a
 *  time-limit hit returns nothing at all — see the module comment). Same row cap. */
export const STATS_SCAN_BUDGET: ScanBudget = { maxSeconds: 10, maxRows: 20_000_000 };

/** Values suggested by the prefix lookup (the sampled list is merged in after them). */
export const PREFIX_LOOKUP_LIMIT = 20;

/**
 * SETTINGS fragments for a budgeted query. The budget is listed both before and after the view's
 * own fragments: `withSettings` keeps the first value of an overflow-mode key (builder-owned) and
 * the last value of every other key, so the budget wins both ways — a view's extra settings can't
 * lift the cap (`max_execution_time = 60`) or turn the `'break'` back into a throw. The wall clock
 * never exceeds the view's own query timeout.
 */
export function budgetSettingsFragments(config: SourceConfig, budget: ScanBudget): string[] {
  const seconds = Math.max(1, Math.min(budget.maxSeconds, config.queryTimeoutSeconds ?? DEFAULT_QUERY_TIMEOUT_SECONDS));
  const own = [
    `max_execution_time = ${seconds}`,
    `timeout_overflow_mode = 'break'`,
    `max_rows_to_read = ${Math.max(1, Math.floor(budget.maxRows))}`,
    `read_overflow_mode = 'break'`,
  ];
  return [...own, ...configSettingsFragments(config), ...own];
}

/** KQL wildcard sentinel (sql/kql/_lexer.ts WILDCARD_STAR) — a value prefix holding one is a
 *  wildcard search, not a literal prefix. Inlined to keep this module free of the KQL lexer. */
const WILDCARD_STAR = String.fromCharCode(0xe000);

/** Shortest typed value prefix that triggers the full-range lookup. */
export const MIN_PREFIX_LENGTH = 2;

/** The typed prefix to look up, or null when it is too short or not a literal prefix. Surrounding
 *  double quotes (a quoted KQL value being typed) are dropped. */
export function normalizeValuePrefix(prefix: string | undefined): string | null {
  if (!prefix) {
    return null;
  }
  const p = prefix.replace(/^"/, '').replace(/"$/, '');
  if (p.trim().length < MIN_PREFIX_LENGTH || p.includes(WILDCARD_STAR)) {
    return null;
  }
  return p;
}

export interface PrefixValuesOpts {
  table: string;
  /** Pre-built WHERE conditions (buildWhereConditions: time range + active filters). */
  conditions: string[];
  /** Literal text the value must start with (case-insensitive); escaped here. */
  prefix: string;
  limit?: number;
  budget?: ScanBudget;
}

/**
 * Top values of `sqlExpr` starting with `prefix`, over the whole time range (no sample), most
 * frequent first. `sqlExpr` must be a column expression from field discovery (callers check
 * isSafeColumnExpr); the prefix is user text and only ever reaches SQL through escapeLike +
 * quoteString, so `%`, `_`, `\` and `'` match literally.
 */
export function buildPrefixValuesQuery(config: SourceConfig, sqlExpr: string, opts: PrefixValuesOpts): string {
  const limit = Math.max(1, Math.floor(opts.limit ?? PREFIX_LOOKUP_LIMIT));
  const pattern = quoteString(`${escapeLike(opts.prefix)}%`);
  // The value is filtered by its expression, never by an alias: a SELECT alias shadows a real
  // column of the same name (`value`, `count`) in WHERE, which would change the caller's conditions.
  // The inner aliases are unlikely names; the outer SELECT (no WHERE) renames them for the reader.
  const text = `toString(${sqlExpr})`;
  const where = [...opts.conditions, `${text} ILIKE ${pattern}`, `${text} NOT IN ('{}', '[]', 'null')`];
  return withSettings(
    [
      `SELECT __pv AS value, __pc AS count FROM (`,
      `SELECT ${text} AS __pv, count() AS __pc`,
      `FROM ${tableRef(config, opts.table)}`,
      `WHERE ${where.join(' AND ')}`,
      `GROUP BY __pv`,
      `ORDER BY __pc DESC`,
      `LIMIT ${limit}`,
      `) ORDER BY __pc DESC`,
    ],
    budgetSettingsFragments(config, opts.budget ?? PREFIX_LOOKUP_BUDGET)
  );
}

/**
 * `EXPLAIN ESTIMATE` of the rows a scan over `conditions` reads (after partition / primary-key
 * pruning) — no data is read. Used to tell whether a stats scan hit the row cap. Returns one row
 * per table with a `rows` column.
 */
export function buildRowEstimateQuery(config: SourceConfig, table: string, conditions: string[]): string {
  return withSettings(
    [
      `EXPLAIN ESTIMATE SELECT 1`,
      `FROM ${tableRef(config, table)}`,
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : null,
    ],
    configSettingsFragments(config)
  );
}

/** How a budgeted scan ended. */
export interface ScanStatus {
  /** Rows the result was computed from (matching rows actually aggregated). */
  scanned: number;
  /** true = every matching row was read; false = a budget limit was hit; undefined = unknown. */
  complete?: boolean;
  /** Which limit was hit when `complete` is false. */
  limit?: 'time' | 'rows';
  /** EXPLAIN ESTIMATE rows to read, when available. */
  estimatedRows?: number;
  budget: ScanBudget;
}

/**
 * Decides whether a budgeted aggregate scan was complete.
 * - `timedOut`: the aggregate returned no row at all (see the module comment) → time limit.
 * - scanned ≥ the row cap, or the estimate says more rows than the cap must be read → row limit.
 * - an estimate within the cap → complete; no estimate → unknown (said so in the caption).
 */
export function scanCompleteness(args: {
  scanned: number;
  timedOut: boolean;
  estimatedRows?: number;
  budget: ScanBudget;
}): ScanStatus {
  const { scanned, timedOut, estimatedRows, budget } = args;
  const base = { scanned, budget, ...(estimatedRows != null ? { estimatedRows } : {}) };
  if (timedOut) {
    return { ...base, complete: false, limit: 'time' };
  }
  if (scanned >= budget.maxRows || (estimatedRows != null && estimatedRows > budget.maxRows)) {
    return { ...base, complete: false, limit: 'rows' };
  }
  if (estimatedRows != null) {
    return { ...base, complete: true };
  }
  return base;
}

/** One-line caption for a scan result, e.g. "Scanned 1,234 records over the full time range." */
export function scanCaption(s: ScanStatus): string {
  const n = s.scanned.toLocaleString();
  if (s.complete === false && s.limit === 'time') {
    return `Full-range scan hit the ${s.budget.maxSeconds} s time limit before finishing — no result. Narrow the time range or add filters.`;
  }
  if (s.complete === false) {
    return `Scanned ${n} records (partial: hit the ${s.budget.maxRows.toLocaleString()}-row read limit${
      s.estimatedRows != null ? ` of about ${s.estimatedRows.toLocaleString()}` : ''
    }).`;
  }
  if (s.complete) {
    return `Scanned ${n} records over the full time range (complete).`;
  }
  return `Scanned ${n} records over the full time range (completeness unknown: no row estimate).`;
}
