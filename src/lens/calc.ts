/**
 * Time-series calculations and the window-function SQL behind them (spec LENS-CALC-01,
 * docs/spec/20-lens.md): Cumulative sum, Differences, Moving average, Counter rate (quick functions
 * and formula) and the formula's overall_sum / overall_average / overall_min / overall_max.
 *
 * They run in ONE query: the chart's grouped query becomes a subquery (gap-filled with `WITH FILL`
 * first, so empty buckets take part as Kibana's empty rows do) and an outer SELECT applies window
 * functions per series — `PARTITION BY` the breakdown columns, `ORDER BY` the date bucket. The
 * semantics mirror Kibana's datatable functions (cumulative_sum / derivative / moving_average /
 * counter_rate / overall_metric):
 * - cumulative sum: an empty value adds nothing (the running total carries over);
 * - differences: current − previous, empty when either is empty (a gap breaks the chain);
 * - moving average: the mean of the last `window` non-empty values BEFORE the current bucket (the
 *   current value is not included; empty buckets are skipped); empty for the first bucket and for an
 *   empty current value;
 * - counter rate: like differences, but a drop is a counter reset (the new value is the increase);
 * - overall_*: one value per series over all its buckets (empty values ignored).
 *
 * Every SQL fragment here is built from aliases we produce and numbers we parsed (the window size is
 * clamped to an integer 1–100), never from user text.
 */
import type { LensState, MetricOp } from './state';

/** Quick functions that wrap another metric and need a date histogram. */
export type CalcOp = 'cumulative_sum' | 'differences' | 'moving_average' | 'counter_rate';
export const CALC_OPS: readonly CalcOp[] = ['counter_rate', 'cumulative_sum', 'differences', 'moving_average'];
export const isCalcOp = (op: MetricOp): op is CalcOp => (CALC_OPS as readonly string[]).includes(op);

/** Functions a calculation can wrap (the inner metric). */
export type BaseOp =
  | 'count'
  | 'avg'
  | 'last_value'
  | 'max'
  | 'median'
  | 'min'
  | 'percentile'
  | 'percentile_rank'
  | 'std_dev'
  | 'sum'
  | 'unique';
export const BASE_OPS: readonly BaseOp[] = [
  'avg',
  'count',
  'last_value',
  'max',
  'median',
  'min',
  'percentile',
  'percentile_rank',
  'std_dev',
  'sum',
  'unique',
];
/** Cumulative sum only makes sense for additive metrics (Kibana: count and sum). */
export const CUMULATIVE_BASE_OPS: readonly BaseOp[] = ['count', 'sum'];

/** The metric a calculation is computed on (Cumulative sum / Differences / Moving average). */
export interface MetricRef {
  op: BaseOp;
  field?: string;
  fieldLabel?: string;
  numeric?: boolean;
  percentile?: number;
  /** Percentile rank: the value whose rank is computed. */
  rankValue?: number;
}

export const DEFAULT_RANK_VALUE = 0;
/** Largest |value| a percentile rank accepts (keeps the SQL literal a plain number). */
export const MAX_RANK_VALUE = 1e15;
/** Percentile rank value: any finite number within ±1e15; anything else → the default (0). */
export function cleanRankValue(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && Math.abs(n) <= MAX_RANK_VALUE ? n : DEFAULT_RANK_VALUE;
}

export const DEFAULT_WINDOW = 5;
export const MAX_WINDOW = 100;

/** Moving average window: an integer 1–100; anything else → the default. */
export function clampWindow(w: unknown): number {
  const n = Number(w);
  return Number.isFinite(n) ? Math.min(MAX_WINDOW, Math.max(1, Math.round(n))) : DEFAULT_WINDOW;
}

/** Ops whose inner aggregate is empty (NULL) for a bucket without values; count / sum / unique are 0. */
const NULLABLE_OPS: ReadonlySet<string> = new Set([
  'avg',
  'last_value',
  'max',
  'median',
  'min',
  'percentile',
  'percentile_rank',
  'std_dev',
]);
export const isNullableOp = (op: string): boolean => NULLABLE_OPS.has(op);

/** Kibana's wording of each quick function (grid buttons and labels). */
export const FUNCTION_HELP: Record<Exclude<MetricOp, 'formula'>, string> = {
  avg: 'The mean of the values of a number field.',
  count: 'The number of documents (Count of records).',
  last_value: 'The value of the newest document (by the data view’s time field) that has the field.',
  max: 'The largest value of a number field.',
  median: 'The middle value of a number field (50th percentile).',
  min: 'The smallest value of a number field.',
  percentile: 'The value below which the given percentage of values fall.',
  percentile_rank: 'The percentage of the values of a number field that are less than or equal to the given value.',
  std_dev: 'How much the values of a number field vary around their mean (population standard deviation).',
  sum: 'The total of the values of a number field.',
  unique: 'The number of distinct values of a field (approximate).',
  cumulative_sum:
    'Adds each bucket’s value to the total of all earlier buckets, per series. Empty buckets add nothing.',
  differences:
    'The change from the previous bucket, per series. The first bucket, and any bucket next to an empty one, has no value.',
  moving_average:
    'The average of the previous buckets in the window (the current bucket is not included), per series. Empty buckets are skipped.',
  counter_rate:
    'The rate of a counter that only grows: the increase of its maximum since the previous bucket, per second. A drop is read as a counter reset.',
};

/** A calculation applied in the outer SELECT. */
export interface WindowSql {
  /** `PARTITION BY … ORDER BY <date bucket>` of the time-series functions; null without a date histogram. */
  series: string | null;
  /** `PARTITION BY …` (or empty) of overall_*. */
  overall: string;
}

const frame = (over: string, f: string) => `OVER (${over} ROWS BETWEEN ${f})`;

/** Running total; an empty value adds nothing. */
export const cumulativeSumSql = (a: string, over: string): string =>
  `sum(ifNull(${a}, 0)) ${frame(over, 'UNBOUNDED PRECEDING AND CURRENT ROW')}`;

/** The previous bucket's value of the series (NULL for the first one). */
const previous = (a: string, over: string): string =>
  `lagInFrame(toNullable(${a}), 1, NULL) ${frame(over, '1 PRECEDING AND CURRENT ROW')}`;

/** Current − previous; empty when either is empty. */
export const differencesSql = (a: string, over: string): string => `(${a} - ${previous(a, over)})`;

/**
 * Mean of the last `window` non-empty values before the current bucket (groupArray skips NULLs, so
 * empty buckets are skipped, not counted); empty when the current value is empty or nothing precedes.
 */
export const movingAverageSql = (a: string, over: string, window: number): string =>
  `if(isNull(${a}), NULL, arrayReduce('avgOrNull', arraySlice(groupArray(${a}) ${frame(over, 'UNBOUNDED PRECEDING AND 1 PRECEDING')}, -${clampWindow(window)})))`;

/** Increase since the previous bucket; a drop is a reset (the new value is the increase). */
export const counterRateSql = (a: string, over: string): string => {
  const p = previous(a, over);
  return `multiIf(${p} IS NULL, NULL, ${a} >= ${p}, ${a} - ${p}, ${a})`;
};

export type OverallFn = 'sum' | 'average' | 'min' | 'max';
const OVERALL_SQL: Record<OverallFn, string> = { sum: 'sum', average: 'avg', min: 'min', max: 'max' };
export const overallSql = (fn: OverallFn, a: string, over: string): string => `${OVERALL_SQL[fn]}(${a}) OVER (${over})`;

/** Whether the chart has a date histogram (what every time-series calculation needs). */
export const hasDateHistogram = (s: Pick<LensState, 'buckets'>): boolean =>
  s.buckets.some((b) => b.kind === 'date_histogram');
