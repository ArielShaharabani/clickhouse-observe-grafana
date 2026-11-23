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
import { formatInZone } from '../utils/timeZone';
import { configSettingsFragments, withSettings } from '../sql/settings';
import { isConvertedTimestamp, timeExpr } from '../sql/timeExpr';
import {
  bucketStartSql,
  dashboardBucketSql,
  dashboardFillSql,
  intervalMs as ivMs,
  isCalendarUnit,
  LensInterval,
  parseInterval,
  ResolvedLensInterval,
  resolveLensInterval,
  stepBucket,
} from './interval';
import { FieldIndex } from '../sql/fields';
import { formulaToSql, FormulaSqlContext, lastValueSql, percentileRankSql, stdDevSql } from './formula';
import {
  clampWindow,
  counterRateSql,
  cumulativeSumSql,
  differencesSql,
  isCalcOp,
  isNullableOp,
  movingAverageSql,
  WindowSql,
} from './calc';
import type { RefComputed } from './layers';
import {
  BucketDim,
  clampPercentile,
  cleanRankValue,
  DateHistogramDim,
  dimLabel,
  dimLabelIn,
  DEFAULT_GRANULARITY,
  filterLabel,
  FiltersDim,
  GRANULARITY_TARGETS,
  hasKindColumn,
  hasRef,
  isRankable,
  refMetric,
  usesWindow,
  KIND_MISSING,
  KIND_OTHER,
  KIND_VALUE,
  LensState,
  MAX_TERMS_SIZE,
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

/**
 * Most result rows a chart is drawn from. The app query asks for one more, so a result that was cut
 * is told apart from one that just fits (`LensResult.truncated`).
 */
export const LENS_ROW_LIMIT = 50_000;
/** Row limit of a saved panel's query. */
const PANEL_ROW_LIMIT = 10_000;
const limitSql = (mode: 'app' | 'dashboard') => `LIMIT ${mode === 'app' ? LENS_ROW_LIMIT + 1 : PANEL_ROW_LIMIT}`;

/** Upper bound for gap filling (the auto interval targets ~60 buckets). */
const MAX_FILLED_BUCKETS = 5000;

export const bucketAlias = (i: number) => `b${i}`;
export const metricAlias = (i: number) => `m${i}`;
/** Row-kind column of a top-values bucket with Other / missing on (see KIND_* in state.ts). */
export const kindAlias = (i: number) => `k${i}`;

/**
 * A saved panel's label for a top-values row: Grafana can't read the row-kind column, so the
 * synthetic rows are labelled in SQL ("Other", "(missing)") and a real value spelled the same gets
 * the " (value)" suffix, as Visualize shows it (termCell).
 */
function dashboardTermLabel(b: { other?: boolean; missing?: boolean }, r: string, kind: string): string {
  const clashes = [b.other ? OTHER_VALUE : '', b.missing ? MISSING_VALUE : ''].filter(Boolean);
  const value = clashes.length
    ? `if(${r} IN (${clashes.map(quoteString).join(', ')}), concat(${r}, ' (value)'), ${r})`
    : r;
  return `multiIf(${kind} = ${KIND_OTHER}, ${quoteString(OTHER_VALUE)}, ${kind} = ${KIND_MISSING}, ${quoteString(MISSING_VALUE)}, ${value})`;
}
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
 * selector) turns it into the conditional form (`countIf`, `avgIf`, `quantileIf`, …). `orNull`
 * (window mode, LENS-CALC-01): an aggregate over no values is NULL — an empty bucket — instead of
 * 0 / nan; count, sum and unique count of nothing stay 0. A calculation's aggregate is its inner
 * metric's (Counter rate: the maximum of its field); the calculation itself is applied by the
 * outer SELECT (`calcSql`).
 */
function metricSql(m: MetricDim, fctx: FormulaSqlContext, cond?: string, orNull = false): string {
  if (m.op === 'formula') {
    // Parsed, validated and compiled from the AST (formula.ts); an invalid formula yields no value.
    return formulaToSql(m.formula ?? '', m.formulaFields ?? {}, { ...fctx, rowCond: cond }) ?? 'NULL';
  }
  if (hasRef(m.op)) {
    return metricSql(refMetric(m), fctx, cond, orNull);
  }
  if (m.op === 'count' || !m.field) {
    return cond ? `countIf(${cond})` : 'count()';
  }
  const f = quoteIdentifier(m.field);
  const x = m.numeric ? f : `toFloat64OrNull(toString(${f}))`;
  const nul = orNull ? 'OrNull' : '';
  const agg = (fn: string, arg: string, n = nul) => (cond ? `${fn}If${n}(${arg}, ${cond})` : `${fn}${n}(${arg})`);
  switch (m.op) {
    case 'median':
      return cond ? `quantileIf${nul}(0.5)(${x}, ${cond})` : `quantile${nul}(0.5)(${x})`;
    case 'avg':
      return agg('avg', x);
    case 'sum':
      return agg('sum', x, '');
    case 'min':
      return agg('min', x);
    case 'max':
    case 'counter_rate':
      return agg('max', x);
    case 'unique':
      return agg('uniq', f, '');
    case 'std_dev':
      return stdDevSql(x, cond);
    case 'last_value':
      return lastValueSql(x, cond, fctx.config);
    case 'percentile_rank':
      return percentileRankSql(x, cleanRankValue(m.rankValue), cond);
    case 'percentile': {
      // A number we produce (clamped 1–99), never text from the URL.
      const q = (clampPercentile(m.percentile) / 100).toFixed(2);
      return cond ? `quantileIf${nul}(${q})(${x}, ${cond})` : `quantile${nul}(${q})(${x})`;
    }
    default:
      return 'NULL';
  }
}

/** The outer-SELECT calculation of a quick-function calculation over its inner aggregate `a`. */
function calcSql(m: MetricDim, a: string, w: WindowSql): string {
  if (w.series === null) {
    // No date histogram: no series order, so no value (the chart shows why instead).
    return 'NULL';
  }
  switch (m.op) {
    case 'cumulative_sum':
      return cumulativeSumSql(a, w.series);
    case 'differences':
      return differencesSql(a, w.series);
    case 'moving_average':
      return movingAverageSql(a, w.series, clampWindow(m.window));
    case 'counter_rate':
      return counterRateSql(a, w.series);
    default:
      return a;
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
  // Window mode (LENS-CALC-01): a time-series calculation or overall_* wraps the grouped query in an
  // outer SELECT (see `wrapWindow`). App mode then groups the series' date bucket as a DateTime
  // (`__d`, gap-filled with WITH FILL) and converts it to epoch ms outside.
  const wrapped = state.metrics.some(usesWindow);
  const dateIdx = state.buckets.findIndex((b) => b.kind === 'date_histogram');
  const appDate = wrapped && mode === 'app' && dateIdx >= 0;
  /** The interval of the series' date bucket (window mode, app). */
  let seriesIv: ResolvedLensInterval | undefined;

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

  // Intervals (LENS-DIM-05): custom ranges → the index of every range the value fits; automatic →
  // the bucket start, with a power-of-ten width sized from the data's span (`rng<i>` CTE).
  const rangeBucket = (b: RangeDim, i: number) => {
    const x = rangeValue(b);
    if (b.ranges) {
      if (b.ranges.length === 0) {
        restrictions.push('0');
        selects.push(`0 AS ${bucketAlias(i)}`);
        return;
      }
      // Ranges may overlap: a record counts in every range it fits (as a Filters bucket).
      const conds = b.ranges.map((r) => rangeCond(x, r));
      restrictions.push(`(${conds.map((c) => `(${c})`).join(' OR ')})`);
      const idx = `arrayJoin(arrayFilter(__r -> __r >= 0, [${conds.map((c, k) => `if(${c}, ${k}, -1)`).join(', ')}]))`;
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
      // The horizontal axis' interval, when several buckets are date histograms.
      interval ??= iv;
      intervalMs ??= ivMs(iv);
      if (appDate && i === dateIdx) {
        seriesIv = iv;
        selects.push(`${dateTimeBucketSql(dateSql(b.field), iv)} AS ${DATE_ALIAS}`);
      } else {
        selects.push(`${bucketStartSql(dateSql(b.field), iv)} AS ${bucketAlias(i)}`);
      }
    } else if (b.kind === 'range') {
      rangeBucket(b, i);
    } else if (b.kind === 'filters') {
      filtersBucket(b, i);
    } else {
      const field = quoteIdentifier(b.field);
      const size = Math.min(MAX_TERMS_SIZE, Math.max(1, Math.floor(b.size)));
      const cte = `top${i}`;
      const dir = rankDirOf(b).toUpperCase();
      // A calculation other than Cumulative sum has no single value to rank by: count instead.
      const rankMetric =
        b.rankBy === 'metric' ? state.metrics.find((m) => m.id === b.rankMetric && isRankable(m)) : undefined;
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
        mode === 'dashboard'
          ? `${dashboardTermLabel(b, r, kindAlias(i))} AS ${bucketAlias(i)}`
          : `if(${kindAlias(i)} = ${KIND_VALUE}, ${r}, '') AS ${bucketAlias(i)}`
      );
    }
  });
  // Normalize by unit: value per second / minute / hour / day of the date bucket. Counter rate is
  // always per unit of time (per second unless set otherwise).
  const normalized = (m: MetricDim, expr: string): string => {
    const unit = m.op === 'counter_rate' ? (m.normalize ?? 's') : m.normalize;
    if (!unit || !hasDateHistogram) {
      return expr;
    }
    const unitS = NORMALIZE_SECONDS[unit];
    const factor = mode === 'dashboard' ? dashboardPerUnit(unitS) : intervalMs ? perUnit(unitS, intervalMs) : null;
    return factor ? `(${expr}) * ${factor}` : expr;
  };
  // Saved panels: the bucket is `$__interval_s` seconds (auto), at least the typed minimum (fixed
  // units), or the calendar unit (approximated like in the app).
  const dashboardPerUnit = (unitS: number): string => {
    const d = state.buckets[dateIdx];
    const iv = d?.kind === 'date_histogram' ? parseInterval(d.interval) : null;
    if (!iv) {
      return `(${unitS} / $__interval_s)`;
    }
    if (isCalendarUnit(iv.unit) || iv.unit === 'w') {
      return perUnit(unitS, ivMs(iv));
    }
    return `(${unitS} / greatest(${Math.max(1, Math.ceil(ivMs(iv) / 1000))}, $__interval_s))`;
  };

  // Window mode: every aggregate goes to the inner query as `a<k>` (identical ones shared); the
  // metric itself is an outer expression over them.
  const inner: string[] = [];
  const addInner = (sql: string): string => {
    let k = inner.indexOf(sql);
    if (k < 0) {
      inner.push(sql);
      k = inner.length - 1;
    }
    return `a${k}`;
  };
  const groupBy = state.buckets.flatMap((b, i) => {
    const col = appDate && i === dateIdx ? DATE_ALIAS : bucketAlias(i);
    return b.kind === 'terms' && hasKindColumn(b) ? [col, kindAlias(i)] : [col];
  });
  const dateRef = dateIdx < 0 ? null : appDate ? DATE_ALIAS : bucketAlias(dateIdx);
  // Series: the breakdown columns (everything but the date bucket), in date order. Overall: one
  // value per series — date histograms and intervals define the series, other buckets split them;
  // without either, overall is over all rows (Kibana).
  const partition = (cols: string[]) => (cols.length > 0 ? `PARTITION BY ${cols.join(', ')}` : '');
  const seriesOrder = groupBy.filter((g) => g !== dateRef);
  const overallCols = state.buckets.some((b) => b.kind === 'date_histogram' || b.kind === 'range')
    ? state.buckets.flatMap((b, i) =>
        b.kind === 'terms' || b.kind === 'filters'
          ? b.kind === 'terms' && hasKindColumn(b)
            ? [bucketAlias(i), kindAlias(i)]
            : [bucketAlias(i)]
          : []
      )
    : [];
  const win: WindowSql = {
    series: dateRef ? [partition(seriesOrder), `ORDER BY ${dateRef}`].filter(Boolean).join(' ') : null,
    overall: partition(overallCols),
  };
  const outerMetrics: string[] = [];
  state.metrics.forEach((m, i) => {
    if (!wrapped) {
      selects.push(`${normalized(m, metricSql(m, fctx, metricCond(m)))} AS ${metricAlias(i)}`);
      return;
    }
    const cond = metricCond(m);
    let expr: string;
    if (m.op === 'formula') {
      expr =
        formulaToSql(m.formula ?? '', m.formulaFields ?? {}, {
          ...fctx,
          rowCond: cond,
          window: { ...win, inner: addInner },
        }) ?? 'NULL';
    } else {
      const a = addInner(metricSql(m, fctx, cond, isNullableOp(isCalcOp(m.op) ? (m.ref?.op ?? 'max') : m.op)));
      expr = isCalcOp(m.op) ? calcSql(m, a, win) : a;
    }
    outerMetrics.push(`${normalized(m, expr)} AS ${metricAlias(i)}`);
  });

  // With shifts the plain time condition (and its coarse partition bound) is replaced by a
  // prefilter covering every shifted window plus the exact check on the shifted time.
  let outer = conditions;
  if (shifting) {
    const coarse = coarsePrunePredicate(config);
    const windows = [
      `(${timeCond})`,
      ...shifts.map((sp) => `(${ts} >= $__fromTime - ${chInterval(sp)} AND ${ts} <= $__toTime - ${chInterval(sp)})`),
    ];
    outer = [
      ...conditions.filter((c) => c !== timeCond && c !== coarse),
      `(${windows.join(' OR ')})`,
      `${rowTs} >= $__fromTime AND ${rowTs} <= $__toTime`,
    ];
  }
  const allWhere = [...outer, ...restrictions].filter(Boolean).join(' AND ');
  const first = state.buckets[0];
  if (wrapped) {
    const sql = wrapWindow({
      state,
      mode,
      ctes,
      innerSelects: [...selects, ...inner.map((s, k) => `${s} AS a${k}`)],
      outerMetrics,
      tbl,
      arrayJoin: shifting ? `ARRAY JOIN [${[0, ...shifts.map((_x, k) => k + 1)].join(', ')}] AS ${SHIFT_ALIAS}` : null,
      where: allWhere,
      groupBy,
      dateIdx,
      seriesIv,
      countSql: shifting ? `countIf(${SHIFT_ALIAS} = 0)` : 'count()',
      settings: configSettingsFragments(config),
    });
    return { sql, intervalMs, interval };
  }
  let orderBy: string | null = null;
  if (first?.kind === 'date_histogram' && mode === 'dashboard' && fillsEmptyBuckets(state)) {
    // Saved panels, Include empty rows: ClickHouse returns no row for an empty bucket, so Grafana
    // would draw a line straight across the gap. Fill the buckets with zero counts (as Visualize
    // does), per breakdown value: the other group columns lead, so WITH FILL fills within each.
    const rest = groupBy.filter((g) => g !== bucketAlias(0));
    const fill = dashboardFillSql(parseInterval(first.interval), !first.unbound);
    orderBy = `ORDER BY ${[...rest, `${bucketAlias(0)} ${fill}`].join(', ')}`;
  } else if (first?.kind === 'date_histogram' || first?.kind === 'range' || first?.kind === 'filters') {
    orderBy = `ORDER BY ${groupBy.join(', ')}`;
  } else if (first) {
    // Ordered by the chosen rank; the synthetic Other / (missing) rows always come last.
    orderBy = rankOrderBy(state, groupBy, shifting ? `countIf(${SHIFT_ALIAS} = 0)` : 'count()');
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
      limitSql(mode),
    ],
    configSettingsFragments(config)
  );
  return { sql, intervalMs, interval };
}

/** Inner alias of the series' date bucket in app window mode (a DateTime, converted to ms outside). */
const DATE_ALIAS = '__d';
/** Inner alias of the row count (ranking by count in window mode). */
const COUNT_ALIAS = '__c';

/** A number we computed: per-`unitS` factor of a bucket of `ms` milliseconds. */
const perUnit = (unitS: number, ms: number): string => String(Number(((unitS * 1000) / ms).toPrecision(12)));

/** The date bucket as a DateTime (DateTime64(3) for milliseconds), for WITH FILL on calendar steps. */
function dateTimeBucketSql(col: string, iv: LensInterval): string {
  return iv.unit === 'ms'
    ? `toStartOfInterval(toDateTime64(${col}, 3), INTERVAL ${iv.n} MILLISECOND)`
    : `toDateTime(toStartOfInterval(${col}, ${chIntervalOf(iv)}))`;
}

const CH_UNITS: Record<string, string> = {
  ms: 'MILLISECOND',
  s: 'SECOND',
  m: 'MINUTE',
  h: 'HOUR',
  d: 'DAY',
  w: 'WEEK',
  M: 'MONTH',
  y: 'YEAR',
};
/** `INTERVAL n UNIT` from an interval we parsed (integer + keyword from the table). */
const chIntervalOf = (iv: LensInterval): string => `INTERVAL ${Math.max(1, Math.floor(iv.n))} ${CH_UNITS[iv.unit]}`;

/**
 * App window mode, Include empty rows: WITH FILL of the DateTime bucket over the time picker range
 * (the bucket holding the start up to the end), or between buckets with data when not bound to it —
 * the same buckets `shapeLensRows` would add, but before the window functions see the rows.
 */
function appFillSql(iv: LensInterval, bound: boolean): string {
  const step = iv.unit === 'ms' ? `toIntervalMillisecond(${Math.max(1, Math.floor(iv.n))})` : chIntervalOf(iv);
  if (!bound) {
    return `WITH FILL STEP ${step}`;
  }
  return iv.unit === 'ms'
    ? `WITH FILL FROM toStartOfInterval(toDateTime64($__fromTime, 3), ${chIntervalOf(iv)}) TO toDateTime64($__toTime, 3) STEP ${step}`
    : `WITH FILL FROM toDateTime(toStartOfInterval($__fromTime, ${chIntervalOf(iv)})) TO $__toTime STEP ${step}`;
}

/**
 * ORDER BY of a chart whose first bucket is top values: by the chosen rank (a rankable rank metric's
 * column, else the row count `byCount`); the synthetic Other / (missing) rows always come last.
 */
function rankOrderBy(state: LensState, groupBy: string[], byCountSql: string): string {
  const first = state.buckets[0] as TermsDim;
  const dir = rankDirOf(first).toUpperCase();
  const rm =
    first.rankBy === 'metric' ? state.metrics.findIndex((m) => m.id === first.rankMetric && isRankable(m)) : -1;
  const byCount = state.metrics[0]?.op === 'count' && !state.metrics[0].shift ? metricAlias(0) : byCountSql;
  const rank =
    first.rankBy === 'alpha'
      ? `${bucketAlias(0)} ${dir}`
      : state.metrics.length === 0
        ? bucketAlias(0)
        : `${rm >= 0 ? metricAlias(rm) : byCount} ${dir}`;
  const lead = hasKindColumn(first) ? `${kindAlias(0)}, ` : '';
  return `ORDER BY ${lead}${rank}, ${groupBy.join(', ')}`;
}

interface WrapParts {
  state: LensState;
  mode: 'app' | 'dashboard';
  ctes: string[];
  /** Bucket columns (the series date as `__d` in app mode) and the inner aggregates `a<k>`. */
  innerSelects: string[];
  /** The metrics as outer expressions (`… AS m<i>`). */
  outerMetrics: string[];
  tbl: string;
  arrayJoin: string | null;
  where: string;
  /** Inner GROUP BY columns. */
  groupBy: string[];
  dateIdx: number;
  seriesIv?: ResolvedLensInterval;
  /** Row count of a group (time shift: of the unshifted copy). */
  countSql: string;
  settings: string[];
}

/**
 * Window mode (LENS-CALC-01): the grouped query becomes a subquery, gap-filled with WITH FILL per
 * series (before any window function sees the rows: an empty bucket is a row with count 0 and empty
 * other aggregates), and the outer SELECT computes the calculations with window functions. App mode
 * converts the DateTime bucket to epoch ms outside; saved panels keep their `$__timeInterval`
 * DateTime bucket and the dashboard fill.
 */
function wrapWindow(p: WrapParts): string {
  const { state, mode, groupBy, dateIdx } = p;
  const date = dateIdx >= 0 ? (state.buckets[dateIdx] as DateHistogramDim) : undefined;
  const appDate = mode === 'app' && !!date && !!p.seriesIv;
  const dateRef = !date ? null : appDate ? DATE_ALIAS : bucketAlias(dateIdx);
  const first = state.buckets[0];
  const needsCount =
    first?.kind === 'terms' &&
    first.rankBy !== 'alpha' &&
    state.metrics.length > 0 &&
    !(state.metrics[0].op === 'count' && !state.metrics[0].shift);

  // Gap filling, per series: every other group column (and an Intervals width, constant per bucket)
  // leads the ORDER BY, so WITH FILL fills within each series and copies those columns.
  let innerOrder: string | null = null;
  if (date && dateRef && date.emptyRows !== false) {
    const widths = state.buckets.flatMap((b, i) =>
      mode === 'app' && b.kind === 'range' && !b.ranges ? [widthAlias(i)] : []
    );
    const fill =
      appDate && p.seriesIv
        ? appFillSql(p.seriesIv, !date.unbound)
        : dashboardFillSql(parseInterval(date.interval), !date.unbound);
    const lead = [...groupBy.filter((g) => g !== dateRef), ...widths];
    innerOrder = `ORDER BY ${[...lead, `${dateRef} ${fill}`].join(', ')}`;
  }

  const innerSql = [
    p.ctes.length > 0 ? `WITH ${p.ctes.join(',\n     ')}` : null,
    `SELECT ${[...p.innerSelects, ...(needsCount ? [`${p.countSql} AS ${COUNT_ALIAS}`] : [])].join(', ')}`,
    `FROM ${p.tbl}`,
    p.arrayJoin,
    p.where ? `WHERE ${p.where}` : null,
    groupBy.length > 0 ? `GROUP BY ${groupBy.join(', ')}` : null,
    innerOrder,
  ]
    .filter(Boolean)
    .join('\n');

  const outerCols = state.buckets.flatMap((b, i) => {
    const cols: string[] = [];
    if (b.kind === 'terms' && hasKindColumn(b)) {
      cols.push(kindAlias(i));
    }
    if (appDate && i === dateIdx && p.seriesIv) {
      cols.push(
        p.seriesIv.unit === 'ms'
          ? `toUnixTimestamp64Milli(${DATE_ALIAS}) AS ${bucketAlias(i)}`
          : `toUnixTimestamp(${DATE_ALIAS}) * 1000 AS ${bucketAlias(i)}`
      );
    } else {
      cols.push(bucketAlias(i));
    }
    if (mode === 'app' && b.kind === 'range' && !b.ranges) {
      cols.push(widthAlias(i));
    }
    return cols;
  });

  // Drop partial intervals (app): before the window functions, so a running total starts at the
  // first whole bucket (Kibana drops them from the rows the calculations run on).
  const outerWhere =
    appDate && date?.dropPartial && p.seriesIv
      ? `WHERE ${DATE_ALIAS} >= $__fromTime AND ${DATE_ALIAS} + ${
          p.seriesIv.unit === 'ms' ? `toIntervalMillisecond(${p.seriesIv.n})` : chIntervalOf(p.seriesIv)
        } <= $__toTime`
      : null;

  const outerGroup = groupBy.map((g) => (g === DATE_ALIAS ? bucketAlias(dateIdx) : g));
  let orderBy: string | null = null;
  if (first?.kind === 'terms') {
    orderBy = rankOrderBy(state, outerGroup, COUNT_ALIAS);
  } else if (first) {
    orderBy = `ORDER BY ${outerGroup.join(', ')}`;
  }
  return withSettings(
    [
      `SELECT ${[...outerCols, ...p.outerMetrics].join(', ')}`,
      `FROM (`,
      innerSql,
      `)`,
      outerWhere,
      orderBy,
      limitSql(mode),
    ],
    p.settings
  );
}

/**
 * Whether a saved panel gap-fills its date buckets: Include empty rows on (the default) and only
 * count metrics, the series Visualize itself draws as zero for an empty bucket (other metrics have
 * no value there, and a filled 0 would be wrong).
 */
export function fillsEmptyBuckets(state: LensState): boolean {
  const x = state.buckets[0];
  return (
    x?.kind === 'date_histogram' &&
    x.emptyRows !== false &&
    state.metrics.length > 0 &&
    state.metrics.every((m) => m.op === 'count')
  );
}

/**
 * Computed reference lines (LENS-LAYER-01): one query, one row, one aggregate per line (`m0`, `m1`,
 * …, in the order of `computedLines`), over the chart's own conditions (query, filters, time). The
 * aggregates are the metric compiler's (quoted fields, sanitized by `sanitizeLens` beforehand).
 */
export function compileReferenceValues(
  lines: Array<{ id: string; computed: RefComputed }>,
  config: SourceConfig,
  conditions: string[],
  timeRange: TimeRange
): { sql: string; ids: string[] } | null {
  if (lines.length === 0) {
    return null;
  }
  const metrics: MetricDim[] = lines.map((l) => ({
    kind: 'metric',
    id: l.id,
    op: l.computed.op,
    ...(l.computed.op === 'count' ? {} : { field: l.computed.field, numeric: l.computed.numeric === true }),
  }));
  const { sql } = compileLens({ chartType: 'metric', buckets: [], metrics }, config, conditions, timeRange);
  return { sql, ids: lines.map((l) => l.id) };
}

/** Alias of the query-annotation index column. */
export const ANNOTATION_INDEX = 'k';
/** Alias of the event time column (epoch ms). */
export const ANNOTATION_TIME = 't';

/**
 * Query annotations (LENS-LAYER-01): the times of the newest matching documents per query, one
 * query for all of them. Each KQL query goes through the search bar's compiler (`filterCond`: an
 * empty query matches everything, an invalid one nothing); `timeConditions` are the standard time
 * conditions only — like Kibana's default ("ignore global filters"), the chart's own query and
 * filters do not apply. Needs the view's time field.
 */
export function compileAnnotationQuery(
  queries: Array<{ id: string; query: string }>,
  config: SourceConfig,
  timeConditions: string[],
  index?: FieldIndex,
  perQuery = 100
): { sql: string; ids: string[] } | null {
  if (queries.length === 0 || !config.columns.timestamp) {
    return null;
  }
  const fctx: FormulaSqlContext = { config, index, dashboard: false };
  const conds = queries.map((q) => filterCond(q.query, fctx));
  const ts = timeExpr(config);
  const k = `arrayJoin(arrayFilter(__a -> __a >= 0, [${conds.map((c, i) => `if(${c}, ${i}, -1)`).join(', ')}]))`;
  const where = [...timeConditions, `(${conds.join(' OR ')})`].join(' AND ');
  const limit = Math.max(1, Math.min(1000, Math.floor(perQuery)));
  const sql = withSettings(
    [
      `SELECT ${k} AS ${ANNOTATION_INDEX}, toUnixTimestamp64Milli(toDateTime64(${ts}, 3)) AS ${ANNOTATION_TIME}`,
      `FROM ${tableRef(config, config.logsTable)}`,
      `WHERE ${where}`,
      `ORDER BY ${ANNOTATION_INDEX}, ${ANNOTATION_TIME} DESC`,
      `LIMIT ${limit} BY ${ANNOTATION_INDEX}`,
      `LIMIT ${limit * queries.length}`,
    ],
    configSettingsFragments(config)
  );
  return { sql, ids: queries.map((q) => q.id) };
}

/** Rows of `compileAnnotationQuery` → event times (ms) per annotation id, newest first. */
export function shapeAnnotationRows(ids: string[], rows: Array<Record<string, unknown>>): Record<string, number[]> {
  const out: Record<string, number[]> = Object.fromEntries(ids.map((id) => [id, []]));
  for (const r of rows) {
    const i = Number(r[ANNOTATION_INDEX]);
    const t = Number(r[ANNOTATION_TIME]);
    if (Number.isInteger(i) && i >= 0 && i < ids.length && Number.isFinite(t)) {
      out[ids[i]].push(t);
    }
  }
  return out;
}

/** The row of `compileReferenceValues` → value per line id (null when the aggregate had no value). */
export function shapeReferenceRow(
  ids: string[],
  row: Record<string, unknown> | undefined
): Record<string, number | null> {
  return Object.fromEntries(
    ids.map((id, i) => {
      const v = row?.[metricAlias(i)];
      const n = v === null || v === undefined || v === '' ? NaN : Number(v);
      return [id, Number.isFinite(n) ? n : null];
    })
  );
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
  /** The query had more rows than `LENS_ROW_LIMIT`: the rest is missing (never drawn as 0). */
  truncated?: boolean;
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

/** A metric value, or null when the query returned none (NULL / nan / inf). */
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') {
    return null;
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

/** Label of a date bucket used as a breakdown: the bucket start, in the chosen zone. */
function dateLabel(ms: number): string {
  return formatInZone(ms, ms % 1000 ? 'YYYY-MM-DD HH:mm:ss.SSS' : ms % 60_000 ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD HH:mm');
}

/** Cell of a bucket (a date histogram on the horizontal axis has none: its position is the time). */
function bucketCell(b: BucketDim | undefined, r: Record<string, unknown>, i: number): TermCell | undefined {
  if (!b || (b.kind === 'date_histogram' && i === 0)) {
    return undefined;
  }
  if (b.kind === 'date_histogram') {
    const t = toMs(r[bucketAlias(i)]);
    return { key: `\u0003${t}`, label: dateLabel(t), synthetic: false };
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

/**
 * The rows a chart is drawn from: at most `LENS_ROW_LIMIT`. When the result was cut inside a date
 * or number bucket (rows come in bucket order) that half-read last bucket is left out too.
 */
function limitRows(
  state: LensState,
  rows: Array<Record<string, unknown>>
): { rows: Array<Record<string, unknown>>; truncated: boolean } {
  if (rows.length <= LENS_ROW_LIMIT) {
    return { rows, truncated: false };
  }
  const kept = rows.slice(0, LENS_ROW_LIMIT);
  const x = state.buckets[0];
  if (x?.kind === 'date_histogram' || x?.kind === 'range') {
    const b0 = bucketAlias(0);
    const next = String(rows[LENS_ROW_LIMIT][b0]);
    const end = kept.findIndex((r) => String(r[b0]) === next);
    if (end > 0) {
      return { rows: kept.slice(0, end), truncated: true };
    }
  }
  return { rows: kept, truncated: true };
}

/** What a cut result means for the reader, or null for a complete one. */
export const truncatedNote = (r: Pick<LensResult, 'truncated'> | undefined): string | null =>
  r?.truncated
    ? `Incomplete: the result has more than ${LENS_ROW_LIMIT.toLocaleString('en-US')} rows and was cut. The missing values are not drawn and totals are too low. Use fewer values or a larger interval.`
    : null;

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
  const { rows: limited, truncated } = limitRows(state, rowsIn);
  const rows =
    xd?.dropPartial && range && canStep
      ? limited.filter((r) => {
          const t = toMs(r[bucketAlias(0)]);
          return t >= range.from && step(t, 1) <= range.to;
        })
      : limited;
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
          zeroFill: !truncated && state.metrics[i].op === 'count',
        };
        seriesMap.set(name, s);
      }
      // An empty value (no data in the bucket, or a calculation without a previous bucket) is a gap,
      // except for counts (0).
      const v = numOrNull(r[metricAlias(i)]);
      if (v !== null || s.zeroFill) {
        s.points.set(xv, v ?? 0);
      }
    });
  }
  if (xIsTime) {
    xs.sort((a, b) => Number(a) - Number(b));
    // ClickHouse returns no row for an empty bucket; fill the gaps so the axis is linear in time
    // (bars and the brush line up with real time). Include empty rows (default on) fills the whole
    // time picker range when bound to it, else only between the first and last bucket with data.
    // Stepping starts from a real bucket so generated starts line up with ClickHouse's.
    if (canStep && xd?.emptyRows !== false && xs.length > 0 && !truncated) {
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
  if (x?.kind === 'range' && !x.ranges && x.emptyRows !== false && xs.length > 1 && rows.length > 0 && !truncated) {
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
    ...state.metrics.map((m, i) => (m.op === 'count' ? num(r[metricAlias(i)]) : numOrNull(r[metricAlias(i)]))),
  ]);
  const xLabels = xs.map((v) => (xIsTime ? String(v) : (xInfo.get(v)?.label ?? String(v))));
  const xSynthetic = xs.map((v) => xInfo.get(v)?.synthetic ?? false);
  return {
    xs,
    xLabels,
    xSynthetic,
    xIsTime,
    series: orderSeries(state, [...seriesMap.values()]),
    table: { columns, rows: tableRows },
    ...(truncated ? { truncated: true } : {}),
  };
}

/**
 * Legend / stack order of a Top values breakdown, as in Kibana: by the rank (count total
 * descending by default; the rank metric's total for "Custom metric"; alphabetical for
 * "Alphabetical"; ascending when the rank direction is), with the synthetic "Other" / "(missing)"
 * series last. Several metrics per breakdown value stay together, in metric order. Other
 * breakdowns keep the query's order.
 */
export function orderSeries(state: LensState, series: LensSeries[]): LensSeries[] {
  const b = state.buckets[1];
  if (b?.kind === 'date_histogram') {
    // Breakdown by date: in time order.
    return [...series].sort(
      (p, q) => Number(p.breakdown) - Number(q.breakdown) || p.metricIndex - q.metricIndex
    );
  }
  if (b?.kind !== 'terms' || series.length < 2) {
    return series;
  }
  const dir = rankDirOf(b) === 'asc' ? 1 : -1;
  // Same rank as the top-N CTE: a rankable rank metric, else the row count (a plain Count metric;
  // with none, the query's order, which already follows it).
  const rankIdx =
    b.rankBy === 'metric'
      ? state.metrics.findIndex((m) => m.id === b.rankMetric && isRankable(m))
      : -1;
  const countIdx = state.metrics.findIndex((m) => m.op === 'count' && !m.shift && !m.filter);
  const useIdx = rankIdx >= 0 ? rankIdx : countIdx;
  const rankCumulative = state.metrics[useIdx]?.op === 'cumulative_sum';
  // One group per breakdown value (its display label, the part every series of the value shares).
  const groupOf = (s: LensSeries) => `${s.synthetic ? '1' : '0'}${s.breakdown ?? ''}`;
  const totals = new Map<string, number>();
  const firstSeen = new Map<string, number>();
  series.forEach((s, i) => {
    const g = groupOf(s);
    if (!firstSeen.has(g)) {
      firstSeen.set(g, i);
    }
    if (s.metricIndex === useIdx) {
      // A cumulative sum's total is its last value (the largest bucket); other metrics add up.
      let t = 0;
      if (rankCumulative) {
        let lastX = -Infinity;
        s.points.forEach((v, x) => {
          if (Number(x) >= lastX) {
            lastX = Number(x);
            t = v;
          }
        });
      } else {
        s.points.forEach((v) => (t += v));
      }
      totals.set(g, t);
    }
  });
  return series
    .map((s, i) => ({ s, i, g: groupOf(s) }))
    .sort((p, q) => {
      if (!!p.s.synthetic !== !!q.s.synthetic) {
        return p.s.synthetic ? 1 : -1;
      }
      if (p.g !== q.g && !p.s.synthetic) {
        const byRank =
          b.rankBy === 'alpha'
            ? dir * (p.s.breakdown ?? '').localeCompare(q.s.breakdown ?? '')
            : dir * ((totals.get(p.g) ?? 0) - (totals.get(q.g) ?? 0));
        if (byRank !== 0) {
          return byRank;
        }
      }
      if (p.g !== q.g) {
        return (firstSeen.get(p.g) ?? 0) - (firstSeen.get(q.g) ?? 0);
      }
      return p.s.metricIndex - q.s.metricIndex || p.i - q.i;
    })
    .map((x) => x.s);
}
