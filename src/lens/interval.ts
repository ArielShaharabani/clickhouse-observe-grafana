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
import { quoteString } from '../sql/queryBuilder';
import { formatInZone, parseInZone, zonedDateTime } from '../utils/timeZone';

export type LensIntervalUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export interface LensInterval {
  n: number;
  unit: LensIntervalUnit;
  /** IANA zone the buckets start in (validated by `toServerTimeZone`); absent = UTC. */
  tz?: string;
  /** Buckets shorter than a day: seconds added before rounding so they line up with the zone's clock. */
  offset?: number;
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

/** Units that follow the zone's calendar: their length varies (DST days, months). */
export const isZonedUnit = (u: LensIntervalUnit): boolean => u === 'd' || u === 'w' || u === 'M' || u === 'y';

/** Bucket width in ms (months / years approximated; use `stepBucket` for exact stepping). */
export const intervalMs = (iv: LensInterval): number => iv.n * UNIT_MS[iv.unit];

/** Whole seconds of a fixed-width (below one day) bucket. */
const fixedSeconds = (iv: LensInterval): number => Math.max(1, Math.ceil(intervalMs(iv) / 1000));

const zoneOf = (tz: string | undefined): string => tz ?? 'UTC';
const tzLit = (tz: string | undefined): string => quoteString(zoneOf(tz));

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
export function resolveLensInterval(
  value: string,
  range: Pick<TimeRange, 'from' | 'to'>,
  tz?: string
): ResolvedLensInterval {
  return inZone(resolveWidth(value, range), range, tz);
}

/** The interval with its zone: the zone itself for days and longer, the clock offset below that. */
function inZone(iv: ResolvedLensInterval, range: Pick<TimeRange, 'from' | 'to'>, tz?: string): ResolvedLensInterval {
  if (!tz || tz === 'UTC' || iv.unit === 'ms') {
    return iv;
  }
  if (isZonedUnit(iv.unit)) {
    return { ...iv, tz };
  }
  // The offset at the range start, used for the whole range so every bucket has the same length.
  const w = fixedSeconds(iv);
  const off = zonedDateTime(range.from.valueOf(), tz).utcOffset() * 60;
  const offset = ((off % w) + w) % w;
  return offset ? { ...iv, offset } : iv;
}

function resolveWidth(value: string, range: Pick<TimeRange, 'from' | 'to'>): ResolvedLensInterval {
  const requested = parseInterval(value);
  if (!requested) {
    const sec = calcBucketInterval(range as TimeRange);
    return sec % 86_400 === 0
      ? { n: sec / 86_400, unit: 'd', scaled: false, requested: null }
      : { n: sec, unit: 's', scaled: false, requested: null };
  }
  const span = Math.max(0, range.to.valueOf() - range.from.valueOf());
  const buckets = span / intervalMs(requested);
  if (buckets <= LENS_MAX_BUCKETS) {
    return { ...requested, scaled: false, requested };
  }
  const n = requested.n * Math.ceil(buckets / LENS_MAX_BUCKETS);
  // Milliseconds wider than a second become whole seconds (never smaller than the cap asks for).
  return requested.unit === 'ms' && n > 1000
    ? { n: Math.ceil(n / 1000), unit: 's', scaled: true, requested }
    : { n, unit: requested.unit, scaled: true, requested };
}

/** `INTERVAL n UNIT`: built from a number we produced and a fixed keyword. */
export const intervalSql = (iv: LensInterval): string =>
  iv.unit === 'ms' || isZonedUnit(iv.unit)
    ? `INTERVAL ${iv.n} ${UNIT_SQL[iv.unit]}`
    : `INTERVAL ${fixedSeconds(iv)} SECOND`;

/**
 * Bucket start of `col` as a DateTime (DateTime64(3) for milliseconds). Days and longer start at
 * midnight in the interval's zone. Shorter buckets are whole steps of seconds: HOUR / MINUTE would
 * follow the column's own zone and start again every midnight, so 5 h buckets would not be 5 h.
 */
export function bucketDateTimeSql(col: string, iv: LensInterval): string {
  if (iv.unit === 'ms') {
    return `toStartOfInterval(toDateTime64(${col}, 3), ${intervalSql(iv)})`;
  }
  if (isZonedUnit(iv.unit)) {
    // Weeks and longer come back as a Date: midnight of that date in the zone.
    return `toDateTime(toStartOfInterval(${col}, ${intervalSql(iv)}, ${tzLit(iv.tz)}), ${tzLit(iv.tz)})`;
  }
  return iv.offset
    ? `toStartOfInterval(${col} + toIntervalSecond(${iv.offset}), ${intervalSql(iv)}) - toIntervalSecond(${iv.offset})`
    : `toStartOfInterval(${col}, ${intervalSql(iv)})`;
}

/** Bucket start of `col` as epoch milliseconds. */
export function bucketStartSql(col: string, iv: LensInterval): string {
  return iv.unit === 'ms'
    ? `toUnixTimestamp64Milli(${bucketDateTimeSql(col, iv)})`
    : `toUnixTimestamp(${bucketDateTimeSql(col, iv)}) * 1000`;
}

/** Real length (seconds) of the calendar bucket that starts at `start` (a DateTime in the zone). */
export const bucketSecondsSql = (start: string, step: string): string =>
  `(toUnixTimestamp(${start} + ${step}) - toUnixTimestamp(${start}))`;

/** A calendar bucket start read back from epoch milliseconds. */
export const msInZoneSql = (ms: string, tz: string | undefined): string =>
  `toDateTime(intDiv(${ms}, 1000), ${tzLit(tz)})`;

/** Saved panels: how many typed intervals go in one bucket, as `resolveLensInterval` scales them. */
function dashboardScale(seconds: number): string {
  const full = seconds * LENS_MAX_BUCKETS;
  return `greatest(1, intDiv(toUnixTimestamp($__toTime) - toUnixTimestamp($__fromTime) + ${full - 1}, ${full}))`;
}

/** Seconds of a saved panel's bucket below one day, or auto (null: calendar units). */
export function dashboardSecondsSql(iv: LensInterval | null): string | null {
  if (!iv) {
    return '$__interval_s';
  }
  return isZonedUnit(iv.unit) ? null : `${fixedSeconds(iv)} * ${dashboardScale(fixedSeconds(iv))}`;
}

/** A saved panel's bucket length as an INTERVAL. */
export function dashboardIntervalSql(iv: LensInterval | null): string {
  if (!iv) {
    return 'INTERVAL $__interval_s second';
  }
  if (!isZonedUnit(iv.unit)) {
    return `INTERVAL ${dashboardSecondsSql(iv)} SECOND`;
  }
  // Days scale like the app; weeks and longer stay far below the cap.
  const n = iv.unit === 'd' ? `${iv.n} * ${dashboardScale(iv.n * 86_400)}` : String(iv.n);
  return `INTERVAL ${n} ${UNIT_SQL[iv.unit]}`;
}

/**
 * Saved dashboard panels: a typed interval stays as typed, scaled up past LENS_MAX_BUCKETS as in
 * Visualize; auto (`iv` null) follows the dashboard's resolution. `tz`: the zone of the chart, fixed
 * in the panel. Buckets below a day, and auto ones, use the zone's offset at the range start.
 */
export function dashboardBucketSql(col: string, iv: LensInterval | null, tz?: string): string {
  return dashboardBucketOf(`toDateTime(${col})`, iv, tz);
}

function dashboardBucketOf(x: string, iv: LensInterval | null, tz?: string): string {
  const step = dashboardIntervalSql(iv);
  if (iv && isZonedUnit(iv.unit)) {
    // toStartOfInterval returns a Date for weeks and longer; a DateTime keeps WITH FILL's types aligned.
    return `toDateTime(toStartOfInterval(${x}, ${step}, ${tzLit(tz)}), ${tzLit(tz)})`;
  }
  if (!tz || tz === 'UTC') {
    return `toStartOfInterval(${x}, ${step})`;
  }
  const off = `timeZoneOffset(toDateTime($__fromTime, ${tzLit(tz)}))`;
  return `toStartOfInterval(${x} + ${off}, ${step}) - ${off}`;
}

/** The end of the dashboard's range in the zone (calendar arithmetic needs the zone). */
export const dashboardToSql = (tz?: string): string => `toDateTime($__toTime, ${tzLit(tz)})`;

/**
 * Gap filling for a saved panel's date buckets (Include empty rows, PARITY-DASHBOARDS): the
 * `WITH FILL` clause matching `dashboardBucketSql` — from the bucket holding the dashboard's start to
 * its end, one bucket per step. `bound: false` (the chart's "bind to time range" off) fills only
 * between buckets with data; `dropPartial` fills whole buckets only.
 */
export function dashboardFillSql(iv: LensInterval | null, bound = true, tz?: string, dropPartial = false): string {
  const interval = dashboardIntervalSql(iv);
  const step = (iv && isZonedUnit(iv.unit) ? null : dashboardSecondsSql(iv)) ?? interval;
  if (!bound) {
    return `WITH FILL STEP ${step}`;
  }
  const from = dashboardBucketOf('$__fromTime', iv, tz);
  const whole = `if(${from} < $__fromTime, ${from} + ${interval}, ${from})`;
  // `greatest`: no whole bucket in the range must be an empty fill, not an error (TO before FROM).
  return dropPartial
    ? `WITH FILL FROM ${whole} TO greatest(${whole}, ${dashboardToSql(tz)} - ${interval} + toIntervalSecond(1)) STEP ${step}`
    : `WITH FILL FROM ${from} TO $__toTime STEP ${step}`;
}

/** `t` moved by `k` buckets: exact for calendar units, in the interval's zone (DST days included). */
export function stepBucket(t: number, iv: LensInterval, k: number): number {
  if (!isZonedUnit(iv.unit)) {
    return t + k * intervalMs(iv);
  }
  const tz = zoneOf(iv.tz);
  const [y, m, d] = formatInZone(t, 'YYYY-M-D', tz).split('-').map(Number);
  const n = iv.n * k;
  const months = iv.unit === 'y' ? 12 * n : iv.unit === 'M' ? n : 0;
  const days = iv.unit === 'w' ? 7 * n : iv.unit === 'd' ? n : 0;
  const day = new Date(Date.UTC(y, m - 1 + months, d + days)).toISOString().slice(0, 10);
  return parseInZone(`${day} 00:00:00`, 'YYYY-MM-DD HH:mm:ss', tz).valueOf();
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
