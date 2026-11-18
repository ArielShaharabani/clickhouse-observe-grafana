/**
 * LensState → ClickHouse SQL (blueprint "Query layer → Lens chart") and query rows → chart series.
 *
 * - date histogram → `toStartOfInterval(ts, INTERVAL n SECOND)` with the Discover auto interval, or
 *   a typed minimum interval (LENS-DIM-05, `interval.ts`: parsed number + unit keyword, never text)
 * - intervals → `floor(x / w) * w` with a power-of-ten width from the data's span, or custom ranges
 *   (`multiIf` over numbers we validated); filters → one bucket per KQL query (`arrayJoin` of the
 *   matching indexes; queries compiled by the search bar's KQL compiler)
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
import { coarsePrunePredicate, quoteIdentifier, quoteString, tableRef } from '../sql/queryBuilder';
import { parseKql, kqlToSql } from '../sql/kql';
import { chInterval, NORMALIZE_SECONDS, parseSpan, spanText, TimeSpan } from './metricOptions';
import { configSettingsFragments, withSettings } from '../sql/settings';
import { isConvertedTimestamp, timeExpr } from '../sql/timeExpr';
import {
  bucketStartSql,
  dashboardBucketSql,
  intervalMs as ivMs,
  LensInterval,
  parseInterval,
  ResolvedLensInterval,
  resolveLensInterval,
  stepBucket,
} from './interval';
import { FieldIndex } from '../sql/fields';
import { formulaToSql, FormulaSqlContext } from './formula';
import {
  BucketDim,
  clampPercentile,
  dimLabel,
  dimLabelIn,
  DEFAULT_GRANULARITY,
  filterLabel,
  FiltersDim,
  GRANULARITY_TARGETS,
  hasKindColumn,
  KIND_MISSING,
  KIND_OTHER,
  KIND_VALUE,
  LensState,
  MetricDim,
  MISSING_VALUE,
  OTHER_VALUE,
  RangeDim,
  rangeLabel,
  RangeSpec,
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
/** Bucket width column of an automatic Intervals bucket. */
export const widthAlias = (i: number) => `w${i}`;

/** A number we validated (finite) as a SQL literal. */
const numLit = (n: number): string => (Number.isFinite(n) ? String(n) : '0');

/** `from <= x < to` of one custom range (open ends omitted). */
function rangeCond(x: string, r: RangeSpec): string {
  const parts = [`${x} IS NOT NULL`];
  if (r.from !== undefined) {
    parts.push(`${x} >= ${numLit(r.from)}`);
  }
  if (r.to !== undefined) {
    parts.push(`${x} < ${numLit(r.to)}`);
  }
  return parts.join(' AND ');
}

/** Numeric value of an Intervals field (cast like the quick functions for a non-number column). */
function rangeValue(b: RangeDim): string {
  const f = quoteIdentifier(b.field);
  return b.numeric ? `toFloat64(${f})` : `toFloat64OrNull(toString(${f}))`;
}

/** WHERE condition of one Filters bucket; an empty query matches everything, an invalid one nothing. */
function filterCond(query: string, fctx: FormulaSqlContext): string {
  if (!query.trim()) {
    return '1';
  }
  try {
    const sql = kqlToSql(parseKql(query), fctx.config, fctx.index);
    if (!sql) {
      return '1';
    }
    // Saved panels: the datasource's macro expander must never see `$__…` text from a query.
    return `(${fctx.dashboard ? sql.replace(/\$/g, () => '\\x24') : sql})`;
  } catch {
    return '0';
  }
}

const MAP_ACCESSOR = /^("(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_]*)\[(.+)\]$/;

/**
 * A metric's aggregate. `cond` (our own SQL: the metric's Filter by / reduced range / time-shift copy
 * selector) turns it into the conditional form (`countIf`, `avgIf`, `quantileIf`, …).
 */
function metricSql(m: MetricDim, fctx: FormulaSqlContext, cond?: string): string {
  if (m.op === 'formula') {
    // Parsed, validated and compiled from the AST (formula.ts); an invalid formula yields no value.
    return formulaToSql(m.formula ?? '', m.formulaFields ?? {}, { ...fctx, rowCond: cond }) ?? 'NULL';
  }
  if (m.op === 'count' || !m.field) {
    return cond ? `countIf(${cond})` : 'count()';
  }
  const f = quoteIdentifier(m.field);
  const x = m.numeric ? f : `toFloat64OrNull(toString(${f}))`;
  const agg = (fn: string, arg: string) => (cond ? `${fn}If(${arg}, ${cond})` : `${fn}(${arg})`);
  switch (m.op) {
    case 'median':
      return cond ? `quantileIf(0.5)(${x}, ${cond})` : `quantile(0.5)(${x})`;
    case 'avg':
      return agg('avg', x);
    case 'sum':
      return agg('sum', x);
    case 'min':
      return agg('min', x);
    case 'max':
      return agg('max', x);
    case 'unique':
      return agg('uniq', f);
    case 'percentile': {
      // A number we produce (clamped 1–99), never text from the URL.
      const q = (clampPercentile(m.percentile) / 100).toFixed(2);
      return cond ? `quantileIf(${q})(${x}, ${cond})` : `quantile(${q})(${x})`;
    }
  }
}

/** Alias of the time-shift copy index (ARRAY JOIN) — see `compileLens`. */
const SHIFT_ALIAS = '__s';

/**
 * Filter by (KQL) of a quick-function metric as a condition, compiled by the search bar's KQL
 * compiler. KQL that does not parse yields `0` (the metric matches nothing) rather than being
 * dropped silently. Formulas use their own `kql=` argument instead.
 */
function metricFilterSql(m: MetricDim, fctx: FormulaSqlContext): string | undefined {
  const q = m.op === 'formula' ? '' : m.filter?.trim();
  if (!q) {
    return undefined;
  }
  try {
    const sql = kqlToSql(parseKql(q), fctx.config, fctx.index);
    // Saved panels: `$` (only possible inside string literals / quoted identifiers) must not reach
    // the datasource's macro expander.
    return `(${fctx.dashboard ? sql.replace(/\$/g, () => '\\x24') : sql})`;
  } catch {
    return '0';
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
  /** Interval of the date histogram, when there is one (ms; months / years approximated). */
  intervalMs?: number;
  /** The date histogram's interval as used (exact stepping for gap filling / click ranges). */
  interval?: ResolvedLensInterval;
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
  mode: 'app' | 'dashboard' = 'app',
  /** Discovered fields, for the `kql=` filters of formulas (same resolution as the search bar). */
  index?: FieldIndex
): CompiledLens {
  const fctx: FormulaSqlContext = { config, index, dashboard: mode === 'dashboard' };
  const tbl = tableRef(config, config.logsTable);
  const where = conditions.length > 0 ? conditions.join(' AND ') : '';
  let intervalMs: number | undefined;
  let interval: ResolvedLensInterval | undefined;
  const ts = config.columns.timestamp ? timeExpr(config) : '';
  const hasDateHistogram = state.buckets.some((b) => b.kind === 'date_histogram');

  // Time shift (LENS-DIM-02 Advanced): every row is read once per distinct shift (ARRAY JOIN over
  // the copy index `__s`); copy k moves the row's time forward by shift k, so "1d ago" data lands
  // in today's buckets. The time window is checked on the shifted time, and each metric only
  // aggregates its own copy (`__s = k`; unshifted metrics and formulas `__s = 0`). Needs the view's
  // time field and the standard time condition (built by buildWhereConditions).
  const timeCond = ts ? `${ts} >= $__fromTime AND ${ts} <= $__toTime` : '';
  const shifts: TimeSpan[] = [];
  if (ts && conditions.includes(timeCond)) {
    for (const m of state.metrics) {
      const sp = m.op === 'formula' ? null : parseSpan(m.shift);
      if (sp && !shifts.some((x) => spanText(x) === spanText(sp))) {
        shifts.push(sp);
      }
    }
  }
  const shifting = shifts.length > 0;
  const shiftIndex = (m: MetricDim): number => {
    const sp = m.op === 'formula' ? null : parseSpan(m.shift);
    return sp ? shifts.findIndex((x) => spanText(x) === spanText(sp)) + 1 : 0;
  };
  /** A time expression as seen by the shift copy (unchanged without shifts). */
  const shifted = (expr: string): string =>
    shifting
      ? `multiIf(${shifts.map((sp, k) => `${SHIFT_ALIAS} = ${k + 1}, ${expr} + ${chInterval(sp)}`).join(', ')}, ${expr})`
      : expr;
  const rowTs = ts ? shifted(ts) : '';

  // A date histogram on the view's time field reads it the way every other query does: a
  // converted time field (epoch / text, PLAN #16d) is not a real DateTime column. Any other field
  // is quoted as before.
  const dateSql = (field: string) =>
    shifted(
      field === config.columns.timestamp && isConvertedTimestamp(config) ? timeExpr(config) : quoteIdentifier(field)
    );

  /** Row condition of a metric: its copy, Filter by, and reduced time range. */
  const metricCond = (m: MetricDim): string | undefined => {
    const parts: string[] = [];
    if (shifting) {
      parts.push(`${SHIFT_ALIAS} = ${shiftIndex(m)}`);
    }
    const f = metricFilterSql(m, fctx);
    if (f) {
      parts.push(f);
    }
    // Reduced time range: only the last span of the time range counts (as in Kibana, not with a
    // date histogram, where every bucket would need its own window).
    const reduced = m.op === 'formula' || hasDateHistogram ? null : parseSpan(m.reducedRange);
    if (reduced && rowTs) {
      parts.push(`${rowTs} > $__toTime - ${chInterval(reduced)}`);
    }
    return parts.length > 0 ? parts.join(' AND ') : undefined;
  };

  const ctes: string[] = [];
  const restrictions: string[] = [];
  const selects: string[] = [];

  // Intervals (LENS-DIM-05): custom ranges → the index of the first matching range; automatic →
  // the bucket start, with a power-of-ten width sized from the data's span (`rng<i>` CTE).
  const rangeBucket = (b: RangeDim, i: number) => {
    const x = rangeValue(b);
    if (b.ranges) {
      if (b.ranges.length === 0) {
        restrictions.push('0');
        selects.push(`0 AS ${bucketAlias(i)}`);
        return;
      }
      const idx = `multiIf(${b.ranges.map((r, k) => `${rangeCond(x, r)}, ${k}`).join(', ')}, -1)`;
      restrictions.push(`${idx} >= 0`);
      selects.push(
        mode === 'dashboard'
          ? `transform(${idx}, [${b.ranges.map((_, k) => k).join(', ')}], [${b.ranges.map((r) => lit(rangeLabel(r))).join(', ')}], '') AS ${bucketAlias(i)}`
          : `${idx} AS ${bucketAlias(i)}`
      );
      return;
    }
    const target = GRANULARITY_TARGETS[(b.granularity ?? DEFAULT_GRANULARITY) - 1] ?? 50;
    const cte = `rng${i}`;
    ctes.push(
      `${cte} AS (SELECT if(max(v) > min(v), exp10(ceil(log10((max(v) - min(v)) / ${target}))), 1) AS w FROM (SELECT ${x} AS v FROM ${tbl}${where ? ` WHERE ${where}` : ''}) WHERE v IS NOT NULL)`
    );
    const w = `(SELECT w FROM ${cte})`;
    restrictions.push(`${x} IS NOT NULL`);
    selects.push(`floor(${x} / ${w}) * ${w} AS ${bucketAlias(i)}`);
    if (mode === 'app') {
      selects.push(`any(${w}) AS ${widthAlias(i)}`);
    }
  };

  // Filters (LENS-DIM-05): a document lands in every bucket whose query it matches.
  const filtersBucket = (b: FiltersDim, i: number) => {
    if (b.filters.length === 0) {
      restrictions.push('0');
      selects.push(`0 AS ${bucketAlias(i)}`);
      return;
    }
    const conds = b.filters.map((f) => filterCond(f.query, fctx));
    restrictions.push(`(${conds.join(' OR ')})`);
    const idx = `arrayJoin(arrayFilter(__f -> __f >= 0, [${conds.map((c, k) => `if(${c}, ${k}, -1)`).join(', ')}]))`;
    selects.push(
      mode === 'dashboard'
        ? `transform(${idx}, [${b.filters.map((_, k) => k).join(', ')}], [${b.filters.map((f) => lit(filterLabel(f))).join(', ')}], '') AS ${bucketAlias(i)}`
        : `${idx} AS ${bucketAlias(i)}`
    );
  };
  state.buckets.forEach((b: BucketDim, i) => {
    const custom = b.kind === 'date_histogram' ? parseInterval(b.interval) : null;
    if (b.kind === 'date_histogram' && mode === 'dashboard' && custom) {
      selects.push(`${dashboardBucketSql(dateSql(b.field), custom)} AS ${bucketAlias(i)}`);
    } else if (b.kind === 'date_histogram' && mode === 'dashboard') {
      const col = dateSql(b.field);
      // The datasource's macro parser counts parentheses and commas without regard to quotes, so
      // an expression field (e.g. a Map key with ')' in it) gets the explicit form instead.
      selects.push(
        /[(),]/.test(col) || shifting
          ? `toStartOfInterval(toDateTime(${col}), INTERVAL $__interval_s second) AS ${bucketAlias(i)}`
          : `$__timeInterval(${col}) AS ${bucketAlias(i)}`
      );
    } else if (b.kind === 'date_histogram') {
      const iv = resolveLensInterval(b.interval, timeRange);
      interval = iv;
      intervalMs = ivMs(iv);
      selects.push(`${bucketStartSql(dateSql(b.field), iv)} AS ${bucketAlias(i)}`);
    } else if (b.kind === 'range') {
      rangeBucket(b, i);
    } else if (b.kind === 'filters') {
      filtersBucket(b, i);
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
            ? `${metricSql(rankMetric, fctx, metricFilterSql(rankMetric, fctx))} ${dir}, v`
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
      // Other and / or "(missing)": the row kind goes in its own column so a real value spelled
      // "Other" / "(missing)" stays a real value. The value expression is inlined (not selected under
      // an alias of its own): only the GROUP BY keys k / b and aggregates may be selected.
      const raw = b.missing ? missingAwareRaw(field) : `toString(${field})`;
      const r = raw;
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
        `multiIf(${r} IS NULL, ${KIND_MISSING}, ${inTop}, ${KIND_VALUE}, ${KIND_OTHER}) AS ${kindAlias(i)}`,
        `if(${kindAlias(i)} = ${KIND_VALUE}, ${r}, '') AS ${bucketAlias(i)}`
      );
    }
  });
  state.metrics.forEach((m, i) => {
    let expr = metricSql(m, fctx, metricCond(m));
    // Normalize by unit: value per second / minute / hour / day of the date bucket.
    if (m.normalize && hasDateHistogram) {
      const unitS = NORMALIZE_SECONDS[m.normalize];
      const factor =
        mode === 'dashboard'
          ? `(${unitS} / $__interval_s)`
          : intervalMs
            ? String(Number(((unitS * 1000) / intervalMs).toPrecision(12)))
            : null;
      if (factor) {
        expr = `(${expr}) * ${factor}`;
      }
    }
    selects.push(`${expr} AS ${metricAlias(i)}`);
  });

  // With shifts the plain time condition (and its coarse partition bound) is replaced by a
  // prefilter covering every shifted window plus the exact check on the shifted time.
  let outer = conditions;
  if (shifting) {
    const coarse = coarsePrunePredicate(config);
    const windows = [
      `(${timeCond})`,
      ...shifts.map(
        (sp) => `(${ts} >= $__fromTime - ${chInterval(sp)} AND ${ts} <= $__toTime - ${chInterval(sp)})`
      ),
    ];
    outer = [
      ...conditions.filter((c) => c !== timeCond && c !== coarse),
      `(${windows.join(' OR ')})`,
      `${rowTs} >= $__fromTime AND ${rowTs} <= $__toTime`,
    ];
  }
  const allWhere = [...outer, ...restrictions].filter(Boolean).join(' AND ');
  const groupBy = state.buckets.flatMap((b, i) =>
    b.kind === 'terms' && hasKindColumn(b) ? [bucketAlias(i), kindAlias(i)] : [bucketAlias(i)]
  );
  const first = state.buckets[0];
  let orderBy: string | null = null;
  if (first?.kind === 'date_histogram' || first?.kind === 'range' || first?.kind === 'filters') {
    orderBy = `ORDER BY ${groupBy.join(', ')}`;
  } else if (first) {
    // Ordered by the chosen rank; the synthetic Other / (missing) rows always come last.
    const dir = rankDirOf(first).toUpperCase();
    const rm = first.rankBy === 'metric' ? state.metrics.findIndex((m) => m.id === first.rankMetric) : -1;
    const byCount =
      state.metrics[0]?.op === 'count' && !state.metrics[0].shift
        ? metricAlias(0)
        : shifting
          ? `countIf(${SHIFT_ALIAS} = 0)`
          : 'count()';
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
      shifting ? `ARRAY JOIN [${[0, ...shifts.map((_x, k) => k + 1)].join(', ')}] AS ${SHIFT_ALIAS}` : null,
      allWhere ? `WHERE ${allWhere}` : null,
      groupBy.length > 0 ? `GROUP BY ${groupBy.join(', ')}` : null,
      orderBy,
      `LIMIT ${LENS_ROW_LIMIT}`,
    ],
    configSettingsFragments(config)
  );
  return { sql, intervalMs, interval };
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

/** Date histogram shaping inputs (LENS-DIM-05): exact bucket stepping and the time picker range. */
export interface ShapeOptions {
  interval?: LensInterval;
  /** Time picker range (epoch ms): bound empty rows and partial buckets. */
  range?: { from: number; to: number };
}

/** A float bucket start / end normalised so data rows and generated buckets share one key. */
const normNum = (n: number): number => Number(n.toPrecision(12));
const fmtNum = (n: number): string => normNum(n).toLocaleString('en-US', { maximumFractionDigits: 6 });

/** Cell of an Intervals / Filters bucket (top values: `termCell`; date histogram: none). */
function bucketCell(b: BucketDim | undefined, r: Record<string, unknown>, i: number): TermCell | undefined {
  if (!b || b.kind === 'date_histogram') {
    return undefined;
  }
  if (b.kind === 'terms') {
    return termCell(b, r, i);
  }
  const v = r[bucketAlias(i)];
  if (b.kind === 'filters') {
    const k = num(v);
    const f = b.filters[k];
    return { key: `\u0002${k}`, label: f ? filterLabel(f) : String(k), synthetic: false };
  }
  if (b.ranges) {
    const k = num(v);
    const spec = b.ranges[k];
    return { key: `\u0002${k}`, label: spec ? rangeLabel(spec) : String(k), synthetic: false };
  }
  const start = normNum(num(v));
  const w = num(r[widthAlias(i)]);
  return { key: String(start), label: `${fmtNum(start)} – ${fmtNum(start + w)}`, synthetic: false };
}

/** Shapes query rows into chart series: X = buckets[0], one series per metric × breakdown value. */
export function shapeLensRows(
  state: LensState,
  rowsIn: Array<Record<string, unknown>>,
  bucketMs?: number,
  opts: ShapeOptions = {}
): LensResult {
  const [x, breakdown] = state.buckets;
  const xIsTime = x?.kind === 'date_histogram';
  const xd = x?.kind === 'date_histogram' ? x : undefined;
  const { interval, range } = opts;
  const canStep = !!interval || (!!bucketMs && bucketMs > 0);
  const step = (t: number, k: number) => (interval ? stepBucket(t, interval, k) : t + k * (bucketMs ?? 0));
  // Drop partial intervals: buckets the time range covers only in part (first / last).
  const rows =
    xd?.dropPartial && range && canStep
      ? rowsIn.filter((r) => {
          const t = toMs(r[bucketAlias(0)]);
          return t >= range.from && step(t, 1) <= range.to;
        })
      : rowsIn;
  const xs: Array<string | number> = [];
  const xInfo = new Map<string | number, TermCell>();
  const seenX = new Set<string | number>();
  const seriesMap = new Map<string, LensSeries>();
  const multiMetric = state.metrics.length > 1;
  const labels = uniqueMetricLabels(state.metrics);

  for (const r of rows) {
    const xCell = bucketCell(x, r, 0);
    const xv = !x ? '' : xIsTime ? toMs(r[bucketAlias(0)]) : (xCell?.key ?? '');
    if (!seenX.has(xv)) {
      seenX.add(xv);
      xs.push(xv);
      if (xCell) {
        xInfo.set(xv, xCell);
      }
    }
    const bCell = bucketCell(breakdown, r, 1);
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
    // (bars and the brush line up with real time). Include empty rows (default on) fills the whole
    // time picker range when bound to it, else only between the first and last bucket with data.
    // Stepping starts from a real bucket so generated starts line up with ClickHouse's.
    if (canStep && xd?.emptyRows !== false && xs.length > 0) {
      let start = Number(xs[0]);
      let end = Number(xs[xs.length - 1]);
      if (range && !xd?.unbound) {
        const keep = (t: number) => (xd?.dropPartial ? t >= range.from : step(t, 1) > range.from);
        for (let n = 0; n < MAX_FILLED_BUCKETS && keep(step(start, -1)); n++) {
          start = step(start, -1);
        }
        const keepEnd = (t: number) => (xd?.dropPartial ? step(t, 1) <= range.to : t < range.to);
        for (let n = 0; n < MAX_FILLED_BUCKETS && keepEnd(step(end, 1)); n++) {
          end = step(end, 1);
        }
      }
      const filled: number[] = [];
      for (let t = start; t <= end && filled.length <= MAX_FILLED_BUCKETS; t = step(t, 1)) {
        filled.push(t);
      }
      if (filled.length <= MAX_FILLED_BUCKETS && filled.length >= xs.length) {
        const seen = new Set(xs.map(Number));
        // Keep any data bucket the stepping did not land on (e.g. a DST shift), in time order.
        const merged = [...new Set([...filled, ...seen])].sort((a, b) => a - b);
        xs.length = 0;
        xs.push(...merged);
      }
    }
  }
  // Intervals (automatic) with Include empty rows: fill the missing widths between the first and
  // last bucket so the axis is linear in value.
  if (x?.kind === 'range' && !x.ranges && x.emptyRows !== false && xs.length > 1 && rows.length > 0) {
    const w = num(rows[0][widthAlias(0)]);
    const first = Number(xs[0]);
    const last = Number(xs[xs.length - 1]);
    if (w > 0 && (last - first) / w <= MAX_FILLED_BUCKETS) {
      const filled: string[] = [];
      for (let k = 0; first + k * w <= last + w / 2; k++) {
        const start = normNum(first + k * w);
        filled.push(String(start));
        if (!xInfo.has(String(start))) {
          xInfo.set(String(start), {
            key: String(start),
            label: `${fmtNum(start)} – ${fmtNum(start + w)}`,
            synthetic: false,
          });
        }
      }
      xs.length = 0;
      xs.push(...filled);
    }
  }
  const columns = [...state.buckets.map((b) => dimLabelIn(b, state.metrics)), ...labels];
  const tableRows = rows.map((r) => [
    ...state.buckets.map((b, i) => {
      const v = r[bucketAlias(i)];
      if ((b.kind === 'terms' && hasKindColumn(b)) || b.kind === 'range' || b.kind === 'filters') {
        return bucketCell(b, r, i)!.label;
      }
      return b.kind === 'date_histogram' ? toMs(v) : v === null || v === undefined ? null : String(v);
    }),
    ...state.metrics.map((_, i) => num(r[metricAlias(i)])),
  ]);
  const xLabels = xs.map((v) => (xIsTime ? String(v) : (xInfo.get(v)?.label ?? String(v))));
  const xSynthetic = xs.map((v) => xInfo.get(v)?.synthetic ?? false);
  return { xs, xLabels, xSynthetic, xIsTime, series: [...seriesMap.values()], table: { columns, rows: tableRows } };
}
