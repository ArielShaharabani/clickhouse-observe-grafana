/**
 * LensState → ClickHouse SQL (blueprint "Query layer → Lens chart") and query rows → chart series.
 *
 * - date histogram → `toStartOfInterval(ts, INTERVAL n SECOND)` with the Discover auto interval
 * - top values → `toString(field)` restricted to the top N by count (`GLOBAL IN` a ranked CTE, the
 *   same shape as the histogram breakdown); options (rank, Other, missing, include/exclude)
 * - median → `quantile(0.5)`, unique count → `uniq`, average/sum/min/max → the same-named aggregate
 *
 * Field expressions must come from the field model (discovered columns / Map keys / JSON paths):
 * callers run `sanitizeLens` against the discovered fields first, and every expression is also
 * passed through `quoteIdentifier` here (a bare name is quoted; only well-formed Map accessors and
 * dotted paths pass through). Filters/search arrive as already-built WHERE conditions.
 *
 * App mode returns date buckets as epoch milliseconds (no timezone guessing on the way back) for
 * `shapeLensRows`. Dashboard mode (saved panels) returns DateTime from `$__timeInterval` for Grafana
 * panels; its rows are not meant for `shapeLensRows`.
 */
import { TimeRange } from '@grafana/data';
import { SourceConfig } from '../types';
import { quoteIdentifier, quoteString, tableRef } from '../sql/queryBuilder';
import { configSettingsFragments, withSettings } from '../sql/settings';
import { resolveInterval } from '../components/_histogramInterval';
import {
  BucketDim,
  clampPercentile,
  dimLabel,
  dimLabelIn,
  hasKindColumn,
  KIND_MISSING,
  KIND_OTHER,
  KIND_VALUE,
  LensState,
  MetricDim,
  MISSING_VALUE,
  OTHER_VALUE,
  rankDirOf,
  regexError,
  TermsDim,
} from './state';

/** Safety cap on result rows (a date histogram × 9 breakdown values stays far below it). */
export const LENS_ROW_LIMIT = 10_000;

/** Upper bound for gap filling (the auto interval targets ~60 buckets). */
const MAX_FILLED_BUCKETS = 5000;

export const bucketAlias = (i: number) => `b${i}`;
export const metricAlias = (i: number) => `m${i}`;
/** Row-kind column of a top-values bucket with Other / missing on (see KIND_* in state.ts). */
export const kindAlias = (i: number) => `k${i}`;
/** Internal alias of a bucket's string value (underscore-prefixed to stay clear of real columns). */
const rawAlias = (i: number) => `_r${i}`;

const MAP_ACCESSOR = /^("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/;

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

/**
 * String literal for a top-values option. quoteString escapes quotes and backslashes; `$` is also
 * written as \x24 so a saved panel's macro expander never sees `$__…` text from a value.
 */
const lit = (v: string): string => quoteString(v).replace(/\$/g, () => '\\x24');

/** Row filter of a top-values bucket's include / exclude lists, on its (non-null) string expression. */
function valuePredicate(b: TermsDim, expr: string): string | null {
  // Patterns the editor would reject (URL input is untrusted) are skipped; an include list with no
  // usable pattern left matches nothing rather than silently matching everything.
  const usable = (list: string[]) => (b.regex ? list.filter((p) => regexError(p) === null) : list);
  const test = (list: string[]) =>
    b.regex
      ? list.map((p) => `match(${expr}, ${lit(`^(?:${p})$`)})`).join(' OR ')
      : `${expr} IN (${list.map(lit).join(', ')})`;
  const parts: string[] = [];
  if (b.include?.length) {
    const inc = usable(b.include);
    parts.push(inc.length > 0 ? `(${test(inc)})` : '0');
  }
  const exc = usable(b.exclude ?? []);
  if (exc.length > 0) {
    parts.push(`NOT (${test(exc)})`);
  }
  return parts.length > 0 ? parts.join(' AND ') : null;
}

/**
 * The bucket's string value, NULL where the document has no value: a Map accessor reports a
 * missing key as '' so it is tested with mapContains; other fields are NULL only where the column
 * is Nullable (a non-Nullable column has no "missing", an empty string stays a value).
 */
function missingAwareRaw(field: string): string {
  const m = MAP_ACCESSOR.exec(field);
  return m ? `if(mapContains(${m[1]}, ${m[2]}), toString(${field}), NULL)` : `toString(${field})`;
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
  timeRange: TimeRange,
  /**
   * 'dashboard': SQL for a saved panel (LENS-SAVE-01) — date buckets use the ClickHouse
   * datasource's `$__timeInterval` macro and come back as DateTime, so the panel follows the
   * dashboard's time range and resolution instead of the range it was built on.
   */
  mode: 'app' | 'dashboard' = 'app'
): CompiledLens {
  const tbl = tableRef(config, config.logsTable);
  const where = conditions.length > 0 ? conditions.join(' AND ') : '';
  let intervalMs: number | undefined;

  const ctes: string[] = [];
  const restrictions: string[] = [];
  const selects: string[] = [];
  state.buckets.forEach((b: BucketDim, i) => {
    if (b.kind === 'date_histogram' && mode === 'dashboard') {
      const col = quoteIdentifier(b.field);
      // The datasource's macro parser counts parentheses and commas without regard to quotes, so
      // an expression field (e.g. a Map key with ')' in it) gets the explicit form instead.
      selects.push(
        /[(),]/.test(col)
          ? `toStartOfInterval(toDateTime(${col}), INTERVAL $__interval_s second) AS ${bucketAlias(i)}`
          : `$__timeInterval(${col}) AS ${bucketAlias(i)}`
      );
    } else if (b.kind === 'date_histogram') {
      const iv = resolveInterval('auto', timeRange);
      intervalMs = iv.intervalMs;
      selects.push(
        `toUnixTimestamp(toStartOfInterval(${quoteIdentifier(b.field)}, INTERVAL ${iv.value} ${iv.unit})) * 1000 AS ${bucketAlias(i)}`
      );
    } else {
      const field = quoteIdentifier(b.field);
      const size = Math.max(1, Math.floor(b.size));
      const cte = `top${i}`;
      const dir = rankDirOf(b).toUpperCase();
      const rankMetric = b.rankBy === 'metric' ? state.metrics.find((m) => m.id === b.rankMetric) : undefined;
      const rank =
        b.rankBy === 'alpha'
          ? `v ${dir}`
          : rankMetric
            ? `${metricSql(rankMetric)} ${dir}, v`
            : b.rankDir === 'asc'
              ? 'count() ASC, v'
              : 'count() DESC';
      const cteWhere = (nn: string) => `${where ? `${where} AND ` : ''}${nn}`;
      if (!hasKindColumn(b)) {
        const raw = `toString(${field})`;
        const pred = valuePredicate(b, raw);
        // NULL never matches the outer GLOBAL IN, so it must not take one of the top-N slots either.
        const notNull = pred ? `${raw} IS NOT NULL AND ${pred}` : `${raw} IS NOT NULL`;
        ctes.push(
          `${cte} AS (SELECT ${raw} AS v FROM ${tbl} WHERE ${cteWhere(notNull)} GROUP BY v ORDER BY ${rank} LIMIT ${size})`
        );
        restrictions.push(`${raw} GLOBAL IN (SELECT v FROM ${cte})`);
        selects.push(`${raw} AS ${bucketAlias(i)}`);
        return;
      }
      // Other and / or "(missing)": the value is computed once (`_rN`), the row kind goes in its
      // own column so a real value spelled "Other" / "(missing)" stays a real value.
      const raw = b.missing ? missingAwareRaw(field) : `toString(${field})`;
      const r = rawAlias(i);
      const pred = valuePredicate(b, r);
      const nonNull = pred ? `${r} IS NOT NULL AND ${pred}` : `${r} IS NOT NULL`;
      const cpred = valuePredicate(b, 'v');
      ctes.push(
        `${cte} AS (SELECT ${raw} AS v FROM ${tbl} WHERE ${cteWhere(cpred ? `v IS NOT NULL AND ${cpred}` : 'v IS NOT NULL')} GROUP BY v ORDER BY ${rank} LIMIT ${size})`
      );
      const inTop = `${r} GLOBAL IN (SELECT v FROM ${cte})`;
      // "(missing)" is a bucket of its own on top of the N values; Other keeps every eligible row.
      restrictions.push(
        b.other ? (b.missing ? `(${r} IS NULL OR (${nonNull}))` : nonNull) : `(${r} IS NULL OR ${inTop})`
      );
      selects.push(
        `${raw} AS ${r}`,
        `multiIf(${r} IS NULL, ${KIND_MISSING}, ${inTop}, ${KIND_VALUE}, ${KIND_OTHER}) AS ${kindAlias(i)}`,
        `if(${kindAlias(i)} = ${KIND_VALUE}, ${r}, '') AS ${bucketAlias(i)}`
      );
    }
  });
  state.metrics.forEach((m, i) => selects.push(`${metricSql(m)} AS ${metricAlias(i)}`));

  const allWhere = [where, ...restrictions].filter(Boolean).join(' AND ');
  const groupBy = state.buckets.flatMap((b, i) =>
    b.kind === 'terms' && hasKindColumn(b) ? [bucketAlias(i), kindAlias(i)] : [bucketAlias(i)]
  );
  const first = state.buckets[0];
  let orderBy: string | null = null;
  if (first?.kind === 'date_histogram') {
    orderBy = `ORDER BY ${groupBy.join(', ')}`;
  } else if (first) {
    // Ordered by the chosen rank; the synthetic Other / (missing) rows always come last.
    const dir = rankDirOf(first).toUpperCase();
    const rm = first.rankBy === 'metric' ? state.metrics.findIndex((m) => m.id === first.rankMetric) : -1;
    const byCount = state.metrics[0]?.op === 'count' ? metricAlias(0) : 'count()';
    const rank =
      first.rankBy === 'alpha'
        ? `${bucketAlias(0)} ${dir}`
        : state.metrics.length === 0
          ? bucketAlias(0)
          : `${rm >= 0 ? metricAlias(rm) : byCount} ${dir}`;
    const lead = hasKindColumn(first) ? `${kindAlias(0)}, ` : '';
    orderBy = `ORDER BY ${lead}${rank}, ${groupBy.join(', ')}`;
  }

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
  /** The series is the synthetic "Other" / "(missing)" bucket (its `breakdown` is only its label). */
  synthetic?: boolean;
  /** Index into `state.metrics`. */
  metricIndex: number;
  /** A missing point means 0 (counts); otherwise it's a gap (no data). */
  zeroFill: boolean;
}

export interface LensResult {
  /** X positions in order: bucket start times (ms) for a date X, category strings otherwise. */
  xs: Array<string | number>;
  /** Display text per X position (category text; for the synthetic buckets "Other" / "(missing)"). */
  xLabels: string[];
  /** Per X position: it is the synthetic "Other" / "(missing)" bucket, not a real value. */
  xSynthetic: boolean[];
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

interface TermCell {
  /** Map key: real values as-is (a leading U+0000/U+0001 is escaped), synthetic buckets U+0000-prefixed. */
  key: string;
  label: string;
  synthetic: boolean;
}

/** Undoes the escape of a real value that starts with U+0000 / U+0001 (see TermCell.key). */
export const realKey = (key: string): string => (key.startsWith('\u0001') ? key.slice(1) : key);

/** One top-values cell of a row: value + row-kind column → key / display label / synthetic flag. */
function termCell(b: TermsDim, r: Record<string, unknown>, i: number): TermCell {
  const v = String(r[bucketAlias(i)] ?? '');
  const kind = hasKindColumn(b) ? num(r[kindAlias(i)]) : KIND_VALUE;
  if (kind === KIND_OTHER) {
    return { key: '\u0000other', label: OTHER_VALUE, synthetic: true };
  }
  if (kind === KIND_MISSING) {
    return { key: '\u0000missing', label: MISSING_VALUE, synthetic: true };
  }
  // A real value spelled like a synthetic label is shown with a suffix so the two stay apart.
  const clash = (b.other && v === OTHER_VALUE) || (b.missing && v === MISSING_VALUE);
  return {
    key: v.startsWith('\u0000') || v.startsWith('\u0001') ? `\u0001${v}` : v,
    label: clash ? `${v} (value)` : v,
    synthetic: false,
  };
}

/** Shapes query rows into chart series: X = buckets[0], one series per metric × breakdown value. */
export function shapeLensRows(state: LensState, rows: Array<Record<string, unknown>>, bucketMs?: number): LensResult {
  const [x, breakdown] = state.buckets;
  const xIsTime = x?.kind === 'date_histogram';
  const xs: Array<string | number> = [];
  const xInfo = new Map<string | number, TermCell>();
  const seenX = new Set<string | number>();
  const seriesMap = new Map<string, LensSeries>();
  const multiMetric = state.metrics.length > 1;
  const labels = uniqueMetricLabels(state.metrics);

  for (const r of rows) {
    const xCell = x?.kind === 'terms' ? termCell(x, r, 0) : undefined;
    const xv = !x ? '' : xIsTime ? toMs(r[bucketAlias(0)]) : (xCell?.key ?? '');
    if (!seenX.has(xv)) {
      seenX.add(xv);
      xs.push(xv);
      if (xCell) {
        xInfo.set(xv, xCell);
      }
    }
    const bCell = breakdown?.kind === 'terms' ? termCell(breakdown, r, 1) : undefined;
    const bv = bCell?.label;
    state.metrics.forEach((_m, i) => {
      const label = labels[i];
      const name = bv === undefined ? label : multiMetric ? `${bv} · ${label}` : bv;
      let s = seriesMap.get(name);
      if (!s) {
        s = {
          name,
          points: new Map(),
          // The real value for a real bucket; the label only identifies a synthetic one.
          breakdown: bCell && !bCell.synthetic ? (r[bucketAlias(1)] == null ? '' : String(r[bucketAlias(1)])) : bv,
          synthetic: bCell?.synthetic,
          metricIndex: i,
          zeroFill: state.metrics[i].op === 'count',
        };
        seriesMap.set(name, s);
      }
      s.points.set(xv, num(r[metricAlias(i)]));
    });
  }
  if (xIsTime) {
    xs.sort((a, b) => Number(a) - Number(b));
    // ClickHouse returns no row for an empty bucket; fill the gaps so the axis is linear in time
    // (bars and the brush line up with real time).
    if (bucketMs && bucketMs > 0 && xs.length > 1) {
      const first = Number(xs[0]);
      const last = Number(xs[xs.length - 1]);
      if ((last - first) / bucketMs <= MAX_FILLED_BUCKETS) {
        xs.length = 0;
        for (let t = first; t <= last; t += bucketMs) {
          xs.push(t);
        }
      }
    }
  }
  const columns = [...state.buckets.map((b) => dimLabelIn(b, state.metrics)), ...labels];
  const tableRows = rows.map((r) => [
    ...state.buckets.map((b, i) => {
      const v = r[bucketAlias(i)];
      if (b.kind === 'terms' && hasKindColumn(b)) {
        return termCell(b, r, i).label;
      }
      return b.kind === 'date_histogram' ? toMs(v) : v === null || v === undefined ? null : String(v);
    }),
    ...state.metrics.map((_, i) => num(r[metricAlias(i)])),
  ]);
  const xLabels = xs.map((v) => (xIsTime ? String(v) : (xInfo.get(v)?.label ?? String(v))));
  const xSynthetic = xs.map((v) => xInfo.get(v)?.synthetic ?? false);
  return { xs, xLabels, xSynthetic, xIsTime, series: [...seriesMap.values()], table: { columns, rows: tableRows } };
}
