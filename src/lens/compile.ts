/**
 * LensState → ClickHouse SQL (blueprint "Query layer → Lens chart") and query rows → chart series.
 *
 * - date histogram → `toStartOfInterval(ts, INTERVAL n SECOND)` with the Discover auto interval
 * - top values → `toString(field)` restricted to the top N by count (`GLOBAL IN` a ranked CTE, the
 *   same shape as the histogram breakdown); no "Other" bucket yet
 * - median → `quantile(0.5)`, unique count → `uniq`, average/sum/min/max → the same-named aggregate
 *
 * Field expressions must come from the field model (discovered columns / Map keys / JSON paths):
 * callers run `sanitizeLens` against the discovered fields first, and every expression is also
 * passed through `quoteIdentifier` here (a bare name is quoted; only well-formed Map accessors and
 * dotted paths pass through). Filters/search arrive as already-built WHERE conditions.
 *
 * Date buckets are returned as epoch milliseconds, so no timezone guessing is needed on the way back.
 */
import { TimeRange } from '@grafana/data';
import { SourceConfig } from '../types';
import { quoteIdentifier, tableRef } from '../sql/queryBuilder';
import { configSettingsFragments, withSettings } from '../sql/settings';
import { resolveInterval } from '../components/_histogramInterval';
import { BucketDim, clampPercentile, dimLabel, LensState, MetricDim } from './state';

/** Safety cap on result rows (a date histogram × 9 breakdown values stays far below it). */
export const LENS_ROW_LIMIT = 10_000;

export const bucketAlias = (i: number) => `b${i}`;
export const metricAlias = (i: number) => `m${i}`;

function metricSql(m: MetricDim): string {
  if (m.op === 'count' || !m.field) {
    return 'count()';
  }
  const f = quoteIdentifier(m.field);
  const x = m.numeric ? f : `toFloat64OrNull(toString(${f}))`;
  switch (m.op) {
    case 'median':
      return `quantile(0.5)(${x})`;
    case 'avg':
      return `avg(${x})`;
    case 'sum':
      return `sum(${x})`;
    case 'min':
      return `min(${x})`;
    case 'max':
      return `max(${x})`;
    case 'unique':
      return `uniq(${f})`;
    case 'percentile':
      // A number we produce (clamped 1–99), never text from the URL.
      return `quantile(${(clampPercentile(m.percentile) / 100).toFixed(2)})(${x})`;
  }
}

export interface CompiledLens {
  sql: string;
  /** Interval of the date histogram, when there is one (ms). */
  intervalMs?: number;
}

export function compileLens(
  state: LensState,
  config: SourceConfig,
  conditions: string[],
  timeRange: TimeRange
): CompiledLens {
  const tbl = tableRef(config, config.logsTable);
  const where = conditions.length > 0 ? conditions.join(' AND ') : '';
  let intervalMs: number | undefined;

  const ctes: string[] = [];
  const restrictions: string[] = [];
  const selects: string[] = [];
  state.buckets.forEach((b: BucketDim, i) => {
    if (b.kind === 'date_histogram') {
      const iv = resolveInterval('auto', timeRange);
      intervalMs = iv.intervalMs;
      selects.push(
        `toUnixTimestamp(toStartOfInterval(${quoteIdentifier(b.field)}, INTERVAL ${iv.value} ${iv.unit})) * 1000 AS ${bucketAlias(i)}`
      );
    } else {
      const expr = `toString(${quoteIdentifier(b.field)})`;
      const cte = `top${i}`;
      ctes.push(
        `${cte} AS (SELECT ${expr} AS v FROM ${tbl}${where ? ` WHERE ${where}` : ''} GROUP BY v ORDER BY count() DESC LIMIT ${Math.max(1, Math.floor(b.size))})`
      );
      restrictions.push(`${expr} GLOBAL IN (SELECT v FROM ${cte})`);
      selects.push(`${expr} AS ${bucketAlias(i)}`);
    }
  });
  state.metrics.forEach((m, i) => selects.push(`${metricSql(m)} AS ${metricAlias(i)}`));

  const allWhere = [where, ...restrictions].filter(Boolean).join(' AND ');
  const groupBy = state.buckets.map((_, i) => bucketAlias(i));
  const first = state.buckets[0];
  const orderBy = !first
    ? null
    : first.kind === 'date_histogram'
      ? `ORDER BY ${groupBy.join(', ')}`
      : `ORDER BY ${state.metrics.length > 0 ? `${metricAlias(0)} DESC` : bucketAlias(0)}, ${groupBy.join(', ')}`;

  const sql = withSettings(
    [
      ctes.length > 0 ? `WITH ${ctes.join(',\n     ')}` : null,
      `SELECT ${selects.join(', ')}`,
      `FROM ${tbl}`,
      allWhere ? `WHERE ${allWhere}` : null,
      groupBy.length > 0 ? `GROUP BY ${groupBy.join(', ')}` : null,
      orderBy,
      `LIMIT ${LENS_ROW_LIMIT}`,
    ],
    configSettingsFragments(config)
  );
  return { sql, intervalMs };
}

/** Metric labels made unique ("Median of x", "Median of x (2)") so series never merge. */
export function uniqueMetricLabels(metrics: MetricDim[]): string[] {
  const seen = new Map<string, number>();
  return metrics.map((m) => {
    const base = dimLabel(m);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base} (${n})`;
  });
}

/** One plotted series: a metric (optionally for one breakdown value). */
export interface LensSeries {
  name: string;
  /** Category value or bucket start (ms) → value. */
  points: Map<string | number, number>;
  /** The breakdown value this series is for (undefined without a breakdown). */
  breakdown?: string;
  /** Index into `state.metrics`. */
  metricIndex: number;
}

export interface LensResult {
  /** X positions in order: bucket start times (ms) for a date X, category strings otherwise. */
  xs: Array<string | number>;
  xIsTime: boolean;
  series: LensSeries[];
  /** Rows as returned (for the table), with readable column names. */
  table: { columns: string[]; rows: Array<Array<string | number | null>> };
}

/** Date buckets come back as epoch ms (see compileLens), possibly as a numeric string. */
function toMs(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Shapes query rows into chart series: X = buckets[0], one series per metric × breakdown value. */
export function shapeLensRows(state: LensState, rows: Array<Record<string, unknown>>): LensResult {
  const [x, breakdown] = state.buckets;
  const xIsTime = x?.kind === 'date_histogram';
  const xs: Array<string | number> = [];
  const seenX = new Set<string | number>();
  const seriesMap = new Map<string, LensSeries>();
  const multiMetric = state.metrics.length > 1;
  const labels = uniqueMetricLabels(state.metrics);

  for (const r of rows) {
    const xv = !x ? '' : xIsTime ? toMs(r[bucketAlias(0)]) : String(r[bucketAlias(0)] ?? '');
    if (!seenX.has(xv)) {
      seenX.add(xv);
      xs.push(xv);
    }
    const bv = breakdown ? String(r[bucketAlias(1)] ?? '') : undefined;
    state.metrics.forEach((_m, i) => {
      const label = labels[i];
      const name = bv === undefined ? label : multiMetric ? `${bv} · ${label}` : bv;
      let s = seriesMap.get(name);
      if (!s) {
        s = { name, points: new Map(), breakdown: bv, metricIndex: i };
        seriesMap.set(name, s);
      }
      s.points.set(xv, num(r[metricAlias(i)]));
    });
  }
  if (xIsTime) {
    xs.sort((a, b) => Number(a) - Number(b));
  }
  const columns = [...state.buckets.map((b) => dimLabel(b)), ...labels];
  const tableRows = rows.map((r) => [
    ...state.buckets.map((b, i) => {
      const v = r[bucketAlias(i)];
      return b.kind === 'date_histogram' ? toMs(v) : v === null || v === undefined ? null : String(v);
    }),
    ...state.metrics.map((_, i) => num(r[metricAlias(i)])),
  ]);
  return { xs, xIsTime, series: [...seriesMap.values()], table: { columns, rows: tableRows } };
}
