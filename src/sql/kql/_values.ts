/**
 * Shared value-lookup helper for KQL autocomplete.
 *
 * Wraps buildFieldTopValuesQuery + runQueryRows with a module-level cache keyed
 * by datasourceUid:sqlExpr:coarseTimeBucket:cacheKey — same scheme as
 * FieldStatsPopover so hot entries are often already warm.
 *
 * Table-agnostic: callers supply their own table + pre-built WHERE conditions + a
 * cacheKey representing their current filter state, so this module has no knowledge
 * of LogsQueryState.
 */

import { TimeRange } from '@grafana/data';
import { buildFieldTopValuesQuery, buildNumericStatsQuery, isQuotedIdentifier, isSafeColumnExpr } from '../queryBuilder';
import { buildPrefixValuesQuery, normalizeValuePrefix } from '../fullScan';
import { runQueryRows } from '../../data/runQuery';
import { coarseTimeBucket } from '../timeBucket';
import { SourceConfig } from '../../types';


/** Rows sampled for value lookups unless a caller asks for more (autocomplete stays light). */
export const DEFAULT_SAMPLE_SIZE = 500;

export interface FieldValue {
  value: string;
  count: number;
}

/** Values + the sampled row total the counts/percentages are drawn from — the shape
 *  FieldStatsPopover needs for its "Calculated from N records" caption and per-value percentages.
 *  loadFieldValues() (below) is the same fetch, just discarding `total` for callers that only need
 *  the plain value list (SearchBar/FilterEditForm autocomplete). */
export interface FieldValuesWithTotal {
  values: FieldValue[];
  total: number;
}

export interface LoadFieldValuesOpts {
  /** Table to sample from (e.g. config.logsTable). */
  table: string;
  /** Pre-built WHERE conditions (from buildWhereConditions). */
  conditions: string[];
  timeRange: TimeRange;
  /** Caller-supplied hash of current filter state, so the cache key stays scoped per-page. */
  cacheKey: string;
  limit?: number;
  /** Rows sampled (most recent first). Default 500 for autocomplete; the stats popover uses 5,000.
   *  Part of the cache key: the two surfaces deliberately sample different amounts (autocomplete
   *  runs per keystroke, the popover is a one-off profile), so their entries are separate. */
  sampleSize?: number;
}

// Module-level cache, keyed and shared the same way regardless of caller — FieldStatsPopover and
// the KQL autocomplete path used to keep two separate caches for the identical query shape (top
// distinct values for a field, sampled + bounded the same way by buildFieldTopValuesQuery), which
// meant they could each hold a different answer for the same field+filter context. Exported (not
// just wrapped) so a caller that needs different error handling than loadFieldValuesWithTotal's
// swallow-and-return-empty (see FieldStatsPopover, which surfaces a real error banner instead of
// reading a query failure as "no values") can still read/write the same cache entries directly.
interface CachedFieldValues extends FieldValuesWithTotal {
  fetchedAt: number;
}

export const valuesCache = new Map<string, CachedFieldValues>();

/** Same TTL rationale as sql/keys.ts's KEYS_TTL_MS: a value list is sampled from current row data,
 *  and `coarseTimeBucket` is a stable string for relative time ranges, so without a TTL a value
 *  that starts appearing after the sample was taken stays invisible for the rest of the session. */
export const VALUES_TTL_MS = 120_000;

const inFlight = new Map<string, Promise<FieldValuesWithTotal>>();

/** Exported so a caller doing its own cache read (FieldStatsPopover, which needs the throwing
 *  fetch + a real error banner instead of loadFieldValuesWithTotal's swallow-to-empty) can apply
 *  the same TTL check instead of re-deriving it. */
export function isValuesCacheEntryFresh(entry: CachedFieldValues): boolean {
  return Date.now() - entry.fetchedAt < VALUES_TTL_MS;
}

export function buildValuesCacheKey(uid: string, sqlExpr: string, timeRange: TimeRange, opts: LoadFieldValuesOpts): string {
  const bucket = coarseTimeBucket(timeRange);
  return `${uid}:${sqlExpr}:${opts.table}:${bucket}:${opts.cacheKey}:${opts.sampleSize ?? DEFAULT_SAMPLE_SIZE}`;
}

/** Drops every cached value list for one datasource+table — used by FieldsContext's explicit
 *  refresh(). Cache keys are `uid:sqlExpr:table:bucket:cacheKey`, so table isn't a prefix — match
 *  it as a `:table:` segment instead, same approach as sql/keys.ts's clearKeysCacheForTable. */
export function clearValuesCacheForTable(uid: string, table: string): void {
  const prefix = `${uid}:`;
  const marker = `:${table}:`;
  for (const key of [...valuesCache.keys()]) {
    if (key.startsWith(prefix) && key.includes(marker)) {
      valuesCache.delete(key);
    }
  }
}

/**
 * Runs the actual top-values query (no cache check, no error handling) — the one query-building +
 * row-parsing implementation both loadFieldValuesWithTotal below and FieldStatsPopover's own
 * fetch (which needs to catch the error itself, see its doc comment) call into.
 */
export async function fetchFieldValuesWithTotal(
  config: SourceConfig,
  sqlExpr: string,
  opts: LoadFieldValuesOpts
): Promise<FieldValuesWithTotal> {
  const limit = opts.limit ?? 20;
  const sql = buildFieldTopValuesQuery(config, sqlExpr, {
    table: opts.table,
    conditions: opts.conditions,
    limit,
    sampleSize: opts.sampleSize ?? DEFAULT_SAMPLE_SIZE,
  });
  const rows = await runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange: opts.timeRange, op: 'fieldValues' });
  const values: FieldValue[] = rows.map((r) => ({
    value: String(r['value'] ?? ''),
    count: Number(r['count'] ?? 0),
  }));
  // total is the same for every row — from buildFieldTopValuesQuery's CTE scalar subquery.
  const total = rows.length > 0 ? Number(rows[0]['total'] ?? 0) : 0;
  return { values, total };
}

/**
 * Fetch the top distinct values for a field (by SQL expression), plus the sampled row total the
 * counts were computed from. Results are cached for the current time-bucket + filter context.
 * Best-effort: any query failure resolves to an empty result rather than throwing — the right
 * behavior for autocomplete (no suggestions beats a broken dropdown), but not for a caller that
 * wants to show the user why a fetch failed (see fetchFieldValuesWithTotal for that case).
 */
export async function loadFieldValuesWithTotal(
  config: SourceConfig,
  sqlExpr: string,
  opts: LoadFieldValuesOpts
): Promise<FieldValuesWithTotal> {
  if (!config.datasourceUid) {
    return { values: [], total: 0 };
  }

  const key = buildValuesCacheKey(config.datasourceUid, sqlExpr, opts.timeRange, opts);
  const cached = valuesCache.get(key);
  if (cached && isValuesCacheEntryFresh(cached)) {
    return cached;
  }

  const existing = inFlight.get(key);
  if (existing) {
    return existing;
  }

  const promise = fetchFieldValuesWithTotal(config, sqlExpr, opts)
    .then((result) => {
      valuesCache.set(key, { ...result, fetchedAt: Date.now() });
      return result;
    })
    .catch(() => ({ values: [], total: 0 }))
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, promise);
  return promise;
}

/**
 * Fetch just the top distinct values for a field — the plain-list shape KQL/filter-form
 * autocomplete needs. Thin wrapper over loadFieldValuesWithTotal so both entry points share one
 * fetch + one cache.
 */
export async function loadFieldValues(
  config: SourceConfig,
  sqlExpr: string,
  opts: LoadFieldValuesOpts
): Promise<FieldValue[]> {
  return (await loadFieldValuesWithTotal(config, sqlExpr, opts)).values;
}

export interface NumericBucket {
  from: number;
  to: number;
  count: number;
}

export interface NumericStats {
  min: number;
  max: number;
  median: number;
  /** Sampled rows with a numeric value. */
  count: number;
  /** 10 equal-width buckets from min to max ([] when there is no numeric value). */
  buckets: NumericBucket[];
}

/** Numeric stats + distribution for the field stats popover (DISC-SIDEBAR-02). Throws on failure. */
export async function fetchNumericStats(
  config: SourceConfig,
  sqlExpr: string,
  opts: LoadFieldValuesOpts
): Promise<NumericStats> {
  const sql = buildNumericStatsQuery(config, sqlExpr, {
    table: opts.table,
    conditions: opts.conditions,
    sampleSize: opts.sampleSize ?? DEFAULT_SAMPLE_SIZE,
  });
  const rows = await runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange: opts.timeRange, op: 'fieldValues' });
  const row = rows[0];
  const count = row ? Number(row['n'] ?? 0) : 0;
  if (!row || count === 0) {
    return { min: 0, max: 0, median: 0, count: 0, buckets: [] };
  }
  const min = Number(row['lo']);
  const max = Number(row['hi']);
  const raw = row['buckets'];
  // Array columns may arrive as an array or as JSON text depending on the datasource frame format.
  const counts: number[] = (Array.isArray(raw) ? raw : typeof raw === 'string' ? JSON.parse(raw) : []).map(Number);
  while (counts.length < 10) {
    counts.push(0);
  }
  const width = (max - min) / 10;
  const buckets =
    max > min
      ? counts.slice(0, 10).map((c, i) => ({ from: min + i * width, to: i === 9 ? max : min + (i + 1) * width, count: c }))
      : counts.slice(0, 10).map((c, i) => ({ from: min, to: max, count: i === 0 ? c : 0 }));
  return { min, max, median: Number(row['med']), count, buckets };
}

// ── Full-range prefix lookup (R5-SAMPLING) ──────────────────────────────────────────────────────
// The sampled list above only sees the 500 newest rows, so a rare value is never suggested. Once
// a value prefix is typed, loadPrefixValues runs a budgeted whole-range `ILIKE 'prefix%'` lookup
// (sql/fullScan.ts) through the same cache + in-flight dedupe; mergeValueLists puts its results
// first. Additive: nothing above changes behaviour.

/** Cache key of a prefix lookup: the sampled key with the sample size replaced by the prefix
 *  (lower-cased, since the lookup is case-insensitive), so clearValuesCacheForTable drops both. */
export function buildPrefixCacheKey(uid: string, sqlExpr: string, opts: LoadFieldValuesOpts, prefix: string): string {
  const bucket = coarseTimeBucket(opts.timeRange);
  return `${uid}:${sqlExpr}:${opts.table}:${bucket}:${opts.cacheKey}:prefix=${prefix.toLowerCase()}`;
}

const prefixInFlight = new Map<string, Promise<FieldValue[]>>();

/**
 * Top values of `sqlExpr` starting with `prefix` over the whole time range (budgeted, cached).
 * Never rejects; resolves [] when the prefix is too short / a wildcard, the expression is not a
 * plain column reference, or the lookup fails or hits its time limit.
 */
export async function loadPrefixValues(
  config: SourceConfig,
  sqlExpr: string,
  opts: LoadFieldValuesOpts,
  rawPrefix: string
): Promise<FieldValue[]> {
  const prefix = normalizeValuePrefix(rawPrefix);
  // Only discovered column shapes (bare / Map accessor / dotted path / quoted identifier) — the KQL
  // bar can hand over an undiscovered field name verbatim, which must not reach a new SQL path.
  if (!config.datasourceUid || prefix == null || !(isSafeColumnExpr(sqlExpr) || isQuotedIdentifier(sqlExpr))) {
    return [];
  }
  const key = buildPrefixCacheKey(config.datasourceUid, sqlExpr, opts, prefix);
  const cached = valuesCache.get(key);
  if (cached && isValuesCacheEntryFresh(cached)) {
    return cached.values;
  }
  const existing = prefixInFlight.get(key);
  if (existing) {
    return existing;
  }
  const sql = buildPrefixValuesQuery(config, sqlExpr, { table: opts.table, conditions: opts.conditions, prefix });
  const promise = runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange: opts.timeRange, op: 'fieldValues' })
    .then((rows) => {
      const values = rows.map((r) => ({ value: String(r['value'] ?? ''), count: Number(r['count'] ?? 0) }));
      valuesCache.set(key, { values, total: 0, fetchedAt: Date.now() });
      return values;
    })
    .catch(() => [] as FieldValue[])
    .finally(() => {
      prefixInFlight.delete(key);
    });
  prefixInFlight.set(key, promise);
  return promise;
}

/** Full-range prefix matches first (by count, as returned), then sampled values not already
 *  listed; deduped by exact value. A value in both keeps the full-range count. */
export function mergeValueLists(full: FieldValue[], sampled: FieldValue[]): FieldValue[] {
  const seen = new Set(full.map((v) => v.value));
  return [...full, ...sampled.filter((v) => !seen.has(v.value))];
}
