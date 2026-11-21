/**
 * Date histogram interval (spec LENS-DIM-05): `auto` or a typed minimum interval `<n><unit>`.
 *
 * The typed text is untrusted (URL, saved charts). It is parsed by a strict grammar into a number
 * and a unit from a fixed table; SQL is built only from those (a number we produce and a keyword
 * from the table), never from the text itself.
 */
import { TimeRange } from '@grafana/data';
import { calcBucketInterval } from '../components/_histogramInterval';
import { IntervalMode } from '../types';

export type LensIntervalUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export interface LensInterval {
  n: number;
  unit: LensIntervalUnit;
}

/** Most buckets a custom interval may produce; a smaller interval is scaled up (Kibana's maxBars idea). */
export const LENS_MAX_BUCKETS = 500;
/** Largest typed count (`9999d`). */
const MAX_COUNT = 9999;

const DAY = 86_400_000;
const UNIT_MS: Record<LensIntervalUnit, number> = {
  ms: 1,
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: DAY,
  w: 7 * DAY,
  M: 30 * DAY, // approximate: bucket counting / scaling only
  y: 365 * DAY,
};
const UNIT_SQL: Record<LensIntervalUnit, string> = {
  ms: 'MILLISECOND',
  s: 'SECOND',
  m: 'MINUTE',
  h: 'HOUR',
  d: 'DAY',
  w: 'WEEK',
  M: 'MONTH',
  y: 'YEAR',
};
const UNIT_NAME: Record<LensIntervalUnit, string> = {
  ms: 'millisecond',
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

/** Minimum interval presets of the editor (Kibana's list). */
export const INTERVAL_PRESETS: Array<{ label: string; value: string }> = [
  { label: 'Millisecond', value: '1ms' },
  { label: 'Second', value: '1s' },
  { label: 'Minute', value: '1m' },
  { label: 'Hour', value: '1h' },
  { label: 'Day', value: '1d' },
  { label: 'Week', value: '1w' },
  { label: 'Month', value: '1M' },
  { label: 'Year', value: '1y' },
];

const GRAMMAR = /^([1-9][0-9]{0,3})(ms|s|m|h|d|w|M|y)$/;

/** `5m` → { n: 5, unit: 'm' }; anything else (including `auto`) → null. */
export function parseInterval(text: unknown): LensInterval | null {
  if (typeof text !== 'string') {
    return null;
  }
  const m = GRAMMAR.exec(text.trim());
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  return n >= 1 && n <= MAX_COUNT ? { n, unit: m[2] as LensIntervalUnit } : null;
}

/** Why typed text is not a usable interval, or null. */
export function intervalError(text: string): string | null {
  if (parseInterval(text)) {
    return null;
  }
  return 'Use a whole number and a unit: ms, s, m, h, d, w, M (month) or y — e.g. 5m, 3h, 2w';
}

/** Normalised text form (`5m`). */
export const formatInterval = (iv: LensInterval): string => `${iv.n}${iv.unit}`;

/** Whether a stored interval value is valid (`auto` or the grammar). */
export const isIntervalValue = (v: unknown): v is string => v === 'auto' || parseInterval(v) !== null;

/** "5 minutes", "1 month". */
export function describeInterval(iv: LensInterval): string {
  return `${iv.n} ${UNIT_NAME[iv.unit]}${iv.n === 1 ? '' : 's'}`;
}

export const isCalendarUnit = (u: LensIntervalUnit): boolean => u === 'M' || u === 'y';

/** Bucket width in ms (months / years approximated; use `stepBucket` for exact stepping). */
export const intervalMs = (iv: LensInterval): number => iv.n * UNIT_MS[iv.unit];

export interface ResolvedLensInterval extends LensInterval {
  /** The typed interval was raised to stay under LENS_MAX_BUCKETS. */
  scaled: boolean;
  /** The interval as configured (null for auto). */
  requested: LensInterval | null;
}

/**
 * The interval a date histogram actually uses over `range`: auto → the Discover auto interval
 * (~60 buckets, whole seconds); a typed interval is a *minimum* — when it would produce more than
 * LENS_MAX_BUCKETS buckets its count is multiplied up (same unit, so calendar units stay calendar).
 */
export function resolveLensInterval(value: string, range: Pick<TimeRange, 'from' | 'to'>): ResolvedLensInterval {
  const requested = parseInterval(value);
  if (!requested) {
    const sec = calcBucketInterval(range as TimeRange);
    return { n: sec, unit: 's', scaled: false, requested: null };
  }
  const span = Math.max(0, range.to.valueOf() - range.from.valueOf());
  const buckets = span / intervalMs(requested);
  if (buckets <= LENS_MAX_BUCKETS) {
    return { ...requested, scaled: false, requested };
  }
  const n = Math.min(requested.n * Math.ceil(buckets / LENS_MAX_BUCKETS), 1_000_000);
  return { n, unit: requested.unit, scaled: true, requested };
}

/**
 * Bucket start of `col` as epoch milliseconds. Milliseconds need DateTime64 (sub-second buckets);
 * everything else matches the existing whole-second form.
 */
export function bucketStartSql(col: string, iv: LensInterval): string {
  if (iv.unit === 'ms') {
    return `toUnixTimestamp64Milli(toStartOfInterval(toDateTime64(${col}, 3), INTERVAL ${iv.n} MILLISECOND))`;
  }
  return `toUnixTimestamp(toStartOfInterval(${col}, INTERVAL ${iv.n} ${UNIT_SQL[iv.unit]})) * 1000`;
}

/**
 * Saved dashboard panels: the interval follows the dashboard's resolution but never goes below the
 * configured minimum (fixed units); calendar units keep their calendar buckets.
 */
export function dashboardBucketSql(col: string, iv: LensInterval): string {
  if (isCalendarUnit(iv.unit) || iv.unit === 'w') {
    // toStartOfInterval returns a Date for these units; a DateTime keeps WITH FILL's types aligned.
    return `toDateTime(toStartOfInterval(toDateTime(${col}), INTERVAL ${iv.n} ${UNIT_SQL[iv.unit]}))`;
  }
  const sec = Math.max(1, Math.ceil(intervalMs(iv) / 1000));
  return `toStartOfInterval(toDateTime(${col}), INTERVAL greatest(${sec}, $__interval_s) second)`;
}

/**
 * Gap filling for a saved panel's date buckets (Include empty rows, PARITY-DASHBOARDS): the
 * `WITH FILL` clause matching `dashboardBucketSql` (or the `$__interval_s` auto bucket when `iv` is
 * null) — from the bucket holding the dashboard's start to its end, one bucket per step.
 * `bound: false` (the chart's "bind to time range" off) fills only between buckets with data.
 */
export function dashboardFillSql(iv: LensInterval | null, bound = true): string {
  const interval =
    iv && (isCalendarUnit(iv.unit) || iv.unit === 'w')
      ? `INTERVAL ${iv.n} ${UNIT_SQL[iv.unit]}`
      : iv
        ? `INTERVAL greatest(${Math.max(1, Math.ceil(intervalMs(iv) / 1000))}, $__interval_s) second`
        : 'INTERVAL $__interval_s second';
  const calendar = !!iv && (isCalendarUnit(iv.unit) || iv.unit === 'w');
  const step = calendar ? interval : interval.replace(/^INTERVAL (.*) second$/, '$1');
  return bound
    ? `WITH FILL FROM ${calendar ? `toDateTime(toStartOfInterval($__fromTime, ${interval}))` : `toStartOfInterval($__fromTime, ${interval})`} TO $__toTime STEP ${step}`
    : `WITH FILL STEP ${step}`;
}

/** `t` moved by `k` buckets (calendar-exact for months / years, in UTC like the query's epoch ms). */
export function stepBucket(t: number, iv: LensInterval, k: number): number {
  if (!isCalendarUnit(iv.unit)) {
    return t + k * intervalMs(iv);
  }
  const d = new Date(t);
  const months = (iv.unit === 'y' ? 12 : 1) * iv.n * k;
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

/** Discover histogram interval → Visualize interval (Edit visualization hand-off). */
export function intervalFromDiscover(mode: IntervalMode | undefined): string {
  const map: Partial<Record<IntervalMode, string>> = {
    millisecond: '1ms',
    second: '1s',
    minute: '1m',
    hour: '1h',
    day: '1d',
    week: '1w',
    month: '1M',
    year: '1y',
  };
  return (mode && map[mode]) || 'auto';
}

/** Visualize interval → Discover histogram interval, when Discover has an equivalent (Explore in Discover). */
export function intervalToDiscover(value: string | undefined): IntervalMode | undefined {
  const iv = parseInterval(value);
  if (!iv || iv.n !== 1) {
    return value === 'auto' ? 'auto' : undefined;
  }
  if (iv.unit === 'ms') {
    return 'millisecond';
  }
  const map: Record<Exclude<LensIntervalUnit, 'ms'>, IntervalMode> = {
    s: 'second',
    m: 'minute',
    h: 'hour',
    d: 'day',
    w: 'week',
    M: 'month',
    y: 'year',
  };
  return map[iv.unit];
}
