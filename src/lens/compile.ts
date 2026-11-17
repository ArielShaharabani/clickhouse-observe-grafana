/**
 * LensState → ClickHouse SQL (blueprint "Query layer → Lens chart") and query rows → chart series.
 *
 * - date histogram → `toStartOfInterval(ts, INTERVAL n SECOND)` with the Discover auto interval
 * - top values → `toString(field)` restricted to the top N by count (`GLOBAL IN` a ranked CTE, the
 *   same shape as the histogram breakdown); no "Other" bucket yet
 * - median → `quantile(0.5)`, unique count → `uniq`, average/sum/min/max → the same-named aggregate
 *
 * Field expressions come from the field model (discovered columns / Map keys / JSON paths), never
 * from free text, and filters/search arrive as already-built WHERE conditions.
 */
import { TimeRange } from '@grafana/data';
import { SourceConfig } from '../types';
import { tableRef } from '../sql/queryBuilder';
import { configSettingsFragments, withSettings } from '../sql/settings';
import { resolveInterval } from '../components/_histogramInterval';
import { BucketDim, dimLabel, LensState, MetricDim } from './state';

/** Safety cap on result rows (a date histogram × 9 breakdown values stays far below it). */
export const LENS_ROW_LIMIT = 10_000;

export const bucketAlias = (i: number) => `b${i}`;
export const metricAlias = (i: number) => `m${i}`;

function metricSql(m: MetricDim): string {
  if (m.op === 'count' || !m.field) {
    return 'count()';
  }
  const x = m.numeric ? m.field : `toFloat64OrNull(toString(${m.field}))`;
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
      return `uniq(${m.field})`;
  }
}

export interface CompiledLens {
  sql: string;
  /** Interval of the date histogram, when there is one (ms). */
  intervalMs?: number;
}

export function compileLens(state: LensState, config: SourceConfig, conditions: string[], timeRange: TimeRange): CompiledLens {
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
      selects.push(`toStartOfInterval(${b.field}, INTERVAL ${iv.value} ${iv.unit}) AS ${bucketAlias(i)}`);
    } else {
      const expr = `toString(${b.field})`;
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

/** One plotted series: a metric (optionally for one breakdown value). */
export interface LensSeries {
  name: string;
  /** Category value or bucket start (ms) → value. */
  points: Map<string | number, number>;
}

export interface LensResult {
  /** X positions in order: bucket start times (ms) for a date X, category strings otherwise. */
  xs: Array<string | number>;
  xIsTime: boolean;
  series: LensSeries[];
  /** Rows as returned (for the table), with readable column names. */
  table: { columns: string[]; rows: Array<Array<string | number | null>> };
}

function toMs(v: unknown): number {
  if (typeof v === 'number') {
    return v;
  }
  if (v && typeof v === 'object' && 'valueOf' in v) {
    return Number((v as { valueOf(): number }).valueOf());
  }
  const s = String(v);
  const n = Date.parse(s.includes('T') || s.endsWith('Z') ? s : `${s.replace(' ', 'T')}Z`);
  return Number.isNaN(n) ? 0 : n;
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

  for (const r of rows) {
    const xv = !x ? '' : xIsTime ? toMs(r[bucketAlias(0)]) : String(r[bucketAlias(0)] ?? '');
    if (!seenX.has(xv)) {
      seenX.add(xv);
      xs.push(xv);
    }
    const bv = breakdown ? String(r[bucketAlias(1)] ?? '') : undefined;
    state.metrics.forEach((m, i) => {
      const label = dimLabel(m);
      const name = bv === undefined ? label : multiMetric ? `${bv} · ${label}` : bv;
      let s = seriesMap.get(name);
      if (!s) {
        s = { name, points: new Map() };
        seriesMap.set(name, s);
      }
      s.points.set(xv, num(r[metricAlias(i)]));
    });
  }
  if (xIsTime) {
    xs.sort((a, b) => Number(a) - Number(b));
  }
  const columns = [...state.buckets.map((b) => dimLabel(b)), ...state.metrics.map((m) => dimLabel(m))];
  const tableRows = rows.map((r) => [
    ...state.buckets.map((b, i) => {
      const v = r[bucketAlias(i)];
      return b.kind === 'date_histogram' ? toMs(v) : v === null || v === undefined ? null : String(v);
    }),
    ...state.metrics.map((_, i) => num(r[metricAlias(i)])),
  ]);
  return { xs, xIsTime, series: [...seriesMap.values()], table: { columns, rows: tableRows } };
}
