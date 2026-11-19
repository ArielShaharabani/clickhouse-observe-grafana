/**
 * Histogram bucket-interval math — pure, no React. Split out of VolumeHistogram.tsx so this logic
 * (and its edge cases: auto-sizing to ~60 buckets, week/month/year's calendar-relative anchors not
 * being zero-fillable) is testable without mounting the chart component, and so the component file
 * carries only rendering/interaction code.
 */
import { TimeRange } from '@grafana/data';
import { VolumeDataPoint, IntervalMode } from '../types';
import { CHIntervalUnit } from '../sql/queryBuilder';

const UNIT_SECONDS: Record<Exclude<IntervalMode, 'auto'>, number> = {
  second: 1,
  minute: 60,
  hour:   3_600,
  day:    86_400,
  week:   604_800,
  month:  2_592_000,  // 30 days
  year:   31_536_000, // 365 days
};

const UNIT_CH: Record<Exclude<IntervalMode, 'auto'>, CHIntervalUnit> = {
  second: 'SECOND',
  minute: 'MINUTE',
  hour:   'HOUR',
  day:    'DAY',
  week:   'WEEK',
  month:  'MONTH',
  year:   'YEAR',
};

export interface ResolvedInterval {
  unit: CHIntervalUnit;
  value: number;
  /** Human-readable label, e.g. "Auto - 30 seconds", "Minute" or "Minute, scaled to 15 minutes". */
  label: string;
  /** Bucket width in milliseconds (used for single-click zoom). */
  intervalMs: number;
  /** Set when a fixed interval was too fine for the range and was scaled up: the width actually
   *  used ("15 minutes"). */
  scaledTo?: string;
}

const DAY_SEC = 86_400;

/** Most buckets one histogram query may produce. A fixed interval that would exceed it is scaled
 *  up to the finest step that fits (Kibana: "scaled to 10 minutes"), never disabled. */
export const MAX_BUCKETS = 1000;

/** Round bucket widths (seconds) for auto mode and for scaling a too-fine fixed interval. 3 h and
 *  12 h are here so a 7-day range auto-buckets at 3 h (~56 bars, as Kibana) rather than 6 h. */
const AUTO_STEPS = [
  10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10_800, 21_600, 43_200, DAY_SEC,
  2 * DAY_SEC, 5 * DAY_SEC, 10 * DAY_SEC, 30 * DAY_SEC, 90 * DAY_SEC, 180 * DAY_SEC, 365 * DAY_SEC,
];

function formatDuration(sec: number): string {
  if (sec < 60)    {return `${sec} second${sec !== 1 ? 's' : ''}`;}
  if (sec < 3_600) {return `${sec / 60} minute${sec / 60 !== 1 ? 's' : ''}`;}
  if (sec < DAY_SEC) {return `${sec / 3_600} hour${sec / 3_600 !== 1 ? 's' : ''}`;}
  const days = sec / DAY_SEC;
  if (days % 365 === 0) {return `${days / 365} year${days / 365 !== 1 ? 's' : ''}`;}
  if (days % 30 === 0 && days >= 30) {return `${days / 30} month${days / 30 !== 1 ? 's' : ''}`;}
  if (days % 7 === 0 && days >= 7) {return `${days / 7} week${days / 7 !== 1 ? 's' : ''}`;}
  return `${days} day${days !== 1 ? 's' : ''}`;
}

/** Calculate bucket interval in seconds to target ~60 buckets over the time range. The step
 *  table used to top out at 86400 (1 day) — for anything wider than ~60 days, that floor meant
 *  auto mode kept bucketing by day regardless of range, so a multi-year range produced hundreds
 *  of daily buckets instead of ~60, and every bar collapsed to a hairline. Extending the table out
 *  to yearly steps (and falling back to whole-year multiples beyond that) keeps the target
 *  bucket count roughly constant no matter how wide the range is. */
export function calcBucketInterval(timeRange: TimeRange): number {
  const spanMs = timeRange.to.valueOf() - timeRange.from.valueOf();
  const targetBuckets = 60;
  const rawSec = Math.ceil(spanMs / 1000 / targetBuckets);
  const found = AUTO_STEPS.find((s) => s >= rawSec);
  if (found) {
    return found;
  }
  return Math.ceil(rawSec / (365 * DAY_SEC)) * 365 * DAY_SEC;
}

/** Resolve an IntervalMode + time range into concrete SQL interval + display label. A fixed
 *  second/minute/hour/day interval that would produce more than MAX_BUCKETS bars is scaled up to
 *  the finest round multiple that fits (as Kibana does), and the label says so. */
export function resolveInterval(mode: IntervalMode, timeRange: TimeRange): ResolvedInterval {
  if (mode === 'auto') {
    const sec = calcBucketInterval(timeRange);
    return { unit: 'SECOND', value: sec, label: `Auto - ${formatDuration(sec)}`, intervalMs: sec * 1000 };
  }
  const sec = UNIT_SECONDS[mode];
  const label = mode.charAt(0).toUpperCase() + mode.slice(1);
  const spanSec = Math.max(0, timeRange.to.valueOf() - timeRange.from.valueOf()) / 1000;
  const fixedWidth = mode === 'second' || mode === 'minute' || mode === 'hour' || mode === 'day';
  if (fixedWidth && Math.ceil(spanSec / sec) > MAX_BUCKETS) {
    const scaled =
      AUTO_STEPS.find((s) => s >= sec && s % sec === 0 && Math.ceil(spanSec / s) <= MAX_BUCKETS) ??
      Math.ceil(spanSec / MAX_BUCKETS / (365 * DAY_SEC)) * 365 * DAY_SEC;
    const scaledTo = formatDuration(scaled);
    return {
      unit: 'SECOND',
      value: scaled,
      label: `${label}, scaled to ${scaledTo}`,
      intervalMs: scaled * 1000,
      scaledTo,
    };
  }
  return { unit: UNIT_CH[mode], value: 1, label, intervalMs: sec * 1000 };
}

/** Estimate how many bars a given mode would produce before any scaling. */
export function estimateBucketCount(mode: IntervalMode, timeRange: TimeRange): number {
  const spanMs = timeRange.to.valueOf() - timeRange.from.valueOf();
  const sec = mode === 'auto' ? calcBucketInterval(timeRange) : UNIT_SECONDS[mode];
  return Math.ceil(spanMs / 1000 / sec);
}

/** Week / month / year buckets start on calendar boundaries, so their width varies. */
export function isCalendarUnit(unit: CHIntervalUnit): boolean {
  return unit === 'WEEK' || unit === 'MONTH' || unit === 'YEAR';
}

/** A bucket only partly inside the selected range (Kibana greys these): it starts before `from`
 *  or ends after `to` (the range includes `to`, so a bucket ending exactly at `to` is whole). */
export function isPartialBucket(start: number, bucketMs: number, timeRange: TimeRange): boolean {
  return start < timeRange.from.valueOf() || start + bucketMs > timeRange.to.valueOf();
}

/**
 * Zero-fill missing buckets across the full time range so gaps (e.g. no logs for a stretch of a
 * day query) render as flat-zero bars instead of vanishing.
 * Only safe for fixed-width units (second/minute/hour/day) — ClickHouse's toStartOfInterval anchors
 * these to the Unix epoch, so `floor(t / stepMs) * stepMs` reproduces the same bucket boundaries.
 * week/month/year use calendar-relative anchors instead, so those are left sparse rather than risk
 * misaligned filler bars.
 *
 * Every bucket the query returned is kept, even one starting exactly at the range end: the range is
 * inclusive (`ts <= to`), so a row at `to` lands in a bucket starting at `to` (Kibana shows it as a
 * partial bucket). Dropping it made the "N rows" total, which sums these buckets, one short of every
 * other count for the same range (2,160 vs 2,161 for 08:00-12:00).
 */
export function fillEmptyBuckets(
  points: VolumeDataPoint[],
  resolved: ResolvedInterval,
  timeRange: TimeRange
): VolumeDataPoint[] {
  if (isCalendarUnit(resolved.unit)) {
    return points;
  }
  const stepMs = resolved.intervalMs;
  if (!stepMs || stepMs <= 0) {
    return points;
  }
  const byTime = new Map(points.map((p) => [p.time, p]));
  const start = Math.floor(timeRange.from.valueOf() / stepMs) * stepMs;
  const end = timeRange.to.valueOf();
  const filled: VolumeDataPoint[] = [];
  // Empty filler buckets stop strictly before `end`: a bucket starting at `end` covers only that
  // one instant, so it is drawn only when the query actually returned rows for it (below).
  for (let t = start; t < end && filled.length <= MAX_BUCKETS * 2; t += stepMs) {
    filled.push(byTime.get(t) ?? { time: t, levels: {} });
    byTime.delete(t);
  }
  if (byTime.size === 0) {
    return filled;
  }
  return [...filled, ...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Exact brush range (DISC-CHART-01): the dragged pixels mapped to time, not snapped to buckets.
 * Bars are laid out one per slot, so a position is bucket `i` plus a fraction of its width; for
 * fixed-width buckets that is linear time. The result is whole seconds (`from` down, `to` up),
 * because the datasource's time macros are second precision, so the range shown is the range
 * queried; and it is never narrower than one second (or one pixel's worth of time, if more), so a
 * tiny drag can't produce an empty from == to range.
 */
export function brushRange(
  pct1: number,
  pct2: number,
  bars: Array<{ time: number }>,
  bucketMs: number,
  widthPx: number
): { from: number; to: number } | null {
  const n = bars.length;
  if (n === 0 || !(bucketMs > 0)) {
    return null;
  }
  const slotEnd = (i: number) => (i + 1 < n ? bars[i + 1].time : bars[i].time + bucketMs);
  const timeAt = (pct: number) => {
    const pos = Math.max(0, Math.min(n, (pct / 100) * n));
    const i = Math.min(n - 1, Math.floor(pos));
    return bars[i].time + (pos - i) * (slotEnd(i) - bars[i].time);
  };
  const lo = timeAt(Math.min(pct1, pct2));
  const hi = timeAt(Math.max(pct1, pct2));
  const extentMs = slotEnd(n - 1) - bars[0].time;
  const pxMs = widthPx > 0 ? extentMs / widthPx : 0;
  const minMs = Math.max(1000, Math.ceil(pxMs / 1000) * 1000);
  let from = Math.floor(lo / 1000) * 1000;
  let to = Math.ceil(hi / 1000) * 1000;
  if (to - from < minMs) {
    const mid = (lo + hi) / 2;
    from = Math.floor((mid - minMs / 2) / 1000) * 1000;
    to = from + minMs;
  }
  return { from, to };
}
