/**
 * Newest-first windowed document search (Kibana-style).
 *
 * The document list is `ORDER BY time DESC LIMIT n`. On a long range with a selective filter that
 * is not a prefix of the table's sort key, ClickHouse scans the whole range before it can return
 * the newest rows. Instead, run the same query over a short window ending at the range end and
 * widen backwards only until the page is full. A window is always a *suffix* of the range, so
 * "window returned `limit` rows" proves those rows are exactly the newest `limit` rows of the full
 * range (same rows, same order, same OFFSET semantics); fewer rows means widen. After a capped
 * number of steps the full range is used, so the result is always identical to the single query.
 *
 * The query text is unchanged: the window is applied by narrowing the time range the datasource
 * expands `$__fromTime` / `$__toTime` from.
 */
import { dateTime, TimeRange } from '@grafana/data';
import { LogsQueryState, SourceConfig } from '../types';
import { CORE_ALIAS } from '../sql/queryBuilder';

const HOUR = 3_600_000;

export interface WindowPlanOpts {
  /** First (newest) window width. Default 1 hour. */
  firstMs?: number;
  /** Growth factor between steps. Default 6. */
  factor?: number;
  /** Max number of queries including the final full-range fallback. Default 4. */
  maxSteps?: number;
}

/**
 * Window widths, narrowest first. The last entry is always the whole span (the fallback).
 * A window of at least half the span is not worth a separate step, so it collapses into the
 * full-range fallback; a short span yields just `[spanMs]` (a single plain query).
 */
export function planWindows(spanMs: number, opts: WindowPlanOpts = {}): number[] {
  const factor = Math.max(2, opts.factor ?? 6);
  const maxSteps = Math.max(1, Math.floor(opts.maxSteps ?? 4));
  let w = Math.max(1, opts.firstMs ?? HOUR);
  const out: number[] = [];
  while (out.length < maxSteps - 1 && w * 2 <= spanMs) {
    out.push(w);
    w *= factor;
  }
  out.push(spanMs);
  return out;
}

/** True when the list is ordered by the time column, newest first (the default). */
export function isNewestFirstSort(config: SourceConfig, state: Partial<Pick<LogsQueryState, 'sort' | 'useRawSql'>>): boolean {
  const ts = config.columns.timestamp;
  if (!ts || state.useRawSql) {
    return false;
  }
  const sort = state.sort;
  if (!sort || !sort.col) {
    return true;
  }
  return (sort.col === CORE_ALIAS.timestamp || sort.col === ts) && sort.dir !== 'asc';
}

export interface WindowedResult<Row> {
  rows: Row[];
  /** Width of the window that satisfied the page (the full span when it fell back). */
  windowMs: number;
  /** Queries issued. */
  steps: number;
}

export interface WindowedOpts<Row> {
  fromMs: number;
  toMs: number;
  /** Rows wanted from this call (the SQL LIMIT). */
  limit: number;
  /** Runs the (unchanged) list query over [fromMs, toMs]. */
  run: (range: { fromMs: number; toMs: number }) => Promise<Row[]>;
  signal?: AbortSignal;
  plan?: WindowPlanOpts;
}

/** Runs `run` over growing suffix windows until `limit` rows come back or the full range is used. */
export async function fetchNewestFirst<Row>(opts: WindowedOpts<Row>): Promise<WindowedResult<Row>> {
  const { fromMs, toMs, limit, run, signal } = opts;
  const widths = planWindows(toMs - fromMs, opts.plan);
  let steps = 0;
  let rows: Row[] = [];
  for (const width of widths) {
    if (signal?.aborted) {
      throw new DOMException('The query was aborted.', 'AbortError');
    }
    const isFull = width >= toMs - fromMs;
    rows = await run({ fromMs: isFull ? fromMs : toMs - width, toMs });
    steps++;
    if (isFull || rows.length >= limit) {
      return { rows, windowMs: width, steps };
    }
  }
  return { rows, windowMs: toMs - fromMs, steps };
}

/** TimeRange narrowed to [fromMs, to]; the original is returned untouched for the full range. */
export function narrowTimeRange(range: TimeRange, fromMs: number): TimeRange {
  if (fromMs <= range.from.valueOf()) {
    return range;
  }
  const from = dateTime(fromMs);
  return { from, to: range.to, raw: { from, to: range.raw.to } };
}
