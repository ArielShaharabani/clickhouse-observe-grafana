/**
 * Time-axis ticks for the Visualize XY chart (Kibana parity): ticks on round times in the chosen zone (every
 * 5 minutes, hour, 3 hours, day, month…), a short label per tick and a second row with the date
 * under the first tick and wherever the date changes. Pure (the zone is a parameter), used only
 * by `XyChart`; Discover's histogram has its own axis.
 */
import { TimeZone } from '@grafana/data';
import { formatInZone, parseInZone } from '../../utils/timeZone';

const S = 1000;
const MIN = 60 * S;
const H = 60 * MIN;
const D = 24 * H;

type Unit = 'ms' | 'day' | 'week' | 'month' | 'year';
interface Step {
  unit: Unit;
  /** Count of the unit (ms for fixed steps). */
  n: number;
  /** Approximate length (ms), for choosing. */
  approx: number;
}

const STEPS: Step[] = [
  ...[1, 5, 10, 15, 30].map((n) => ({ unit: 'ms' as const, n: n * S, approx: n * S })),
  ...[1, 2, 5, 10, 15, 30].map((n) => ({ unit: 'ms' as const, n: n * MIN, approx: n * MIN })),
  ...[1, 2, 3, 6, 12].map((n) => ({ unit: 'ms' as const, n: n * H, approx: n * H })),
  { unit: 'day', n: 1, approx: D },
  { unit: 'day', n: 2, approx: 2 * D },
  { unit: 'week', n: 1, approx: 7 * D },
  { unit: 'month', n: 1, approx: 30 * D },
  { unit: 'month', n: 3, approx: 91 * D },
  { unit: 'month', n: 6, approx: 182 * D },
  { unit: 'year', n: 1, approx: 365 * D },
  { unit: 'year', n: 5, approx: 5 * 365 * D },
  { unit: 'year', n: 10, approx: 10 * 365 * D },
];

export interface TimeTick {
  t: number;
  label: string;
  /** Second row (the date / year), under the first tick and where it changes. */
  sub?: string;
}

/** The smallest round step that keeps at most `maxTicks` ticks over [t0, t1]. */
export function timeStep(t0: number, t1: number, maxTicks: number): Step {
  const span = Math.max(1, t1 - t0);
  return STEPS.find((s) => span / s.approx <= Math.max(1, maxTicks)) ?? STEPS[STEPS.length - 1];
}

/** The calendar date (and weekday) of instant `t` in the zone, as a UTC-based Date so calendar maths ignores DST. */
function calendarDay(t: number, tz?: TimeZone): Date {
  const [y, m, d] = formatInZone(t, 'YYYY-M-D', tz).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** The instant of local midnight on a calendar day (a UTC-based Date) in the zone. */
function midnight(c: Date, tz?: TimeZone): number {
  const text = `${String(c.getUTCFullYear()).padStart(4, '0')}-${String(c.getUTCMonth() + 1).padStart(2, '0')}-${String(c.getUTCDate()).padStart(2, '0')} 00:00:00`;
  return parseInZone(text, 'YYYY-MM-DD HH:mm:ss', tz).valueOf();
}

/** First tick at or after `t` for a step, on a round time in the zone. */
function firstTick(t: number, s: Step, tz?: TimeZone): number {
  const c = calendarDay(t, tz);
  if (s.unit === 'ms') {
    // Align within the day, so 3-hour ticks fall on 00, 03, 06… in the zone.
    const day = midnight(c, tz);
    return day + Math.ceil((t - day) / s.n) * s.n;
  }
  if (s.unit === 'day' || s.unit === 'week') {
    if (midnight(c, tz) < t) {
      c.setUTCDate(c.getUTCDate() + 1);
    }
    if (s.unit === 'week') {
      // Mondays.
      while (c.getUTCDay() !== 1) {
        c.setUTCDate(c.getUTCDate() + 1);
      }
    } else if (s.n > 1) {
      while ((c.getUTCDate() - 1) % s.n !== 0) {
        c.setUTCDate(c.getUTCDate() + 1);
      }
    }
    return midnight(c, tz);
  }
  if (s.unit === 'month') {
    const m = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1));
    if (midnight(m, tz) < t) {
      m.setUTCMonth(m.getUTCMonth() + 1);
    }
    while (m.getUTCMonth() % s.n !== 0) {
      m.setUTCMonth(m.getUTCMonth() + 1);
    }
    return midnight(m, tz);
  }
  const y = new Date(Date.UTC(c.getUTCFullYear(), 0, 1));
  if (midnight(y, tz) < t) {
    y.setUTCFullYear(y.getUTCFullYear() + 1);
  }
  while (y.getUTCFullYear() % s.n !== 0) {
    y.setUTCFullYear(y.getUTCFullYear() + 1);
  }
  return midnight(y, tz);
}

function next(t: number, s: Step, tz?: TimeZone): number {
  if (s.unit === 'ms') {
    const n = t + s.n;
    // Re-align after a DST change inside the day (midnight + k·step).
    return s.n < D ? firstTick(n, s, tz) : n;
  }
  if (s.unit === 'day' || s.unit === 'week') {
    // The next midnight that qualifies (n-day steps restart on the 1st of each month).
    return firstTick(t + 1, s, tz);
  }
  const c = calendarDay(t, tz);
  const d = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth(), 1));
  if (s.unit === 'month') {
    d.setUTCMonth(d.getUTCMonth() + s.n);
  } else {
    d.setUTCFullYear(d.getUTCFullYear() + s.n);
  }
  return midnight(d, tz);
}

/**
 * Ticks over [t0, t1] (ms): at most `maxTicks`, on round local times. Labels: `HH:mm` (`HH:mm:ss`
 * under a minute) with the date (`MMMM D, YYYY`) below the first tick and at each new day; days and
 * weeks `MMM D` with the year below; months `MMM` with the year; years `YYYY`.
 */
export function timeTicks(t0: number, t1: number, maxTicks: number, tz?: TimeZone): TimeTick[] {
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) {
    return [];
  }
  const s = timeStep(t0, t1, maxTicks);
  const out: TimeTick[] = [];
  const fmt = (t: number, f: string) => formatInZone(t, f, tz);
  const label =
    s.unit === 'ms'
      ? s.n < MIN
        ? 'HH:mm:ss'
        : 'HH:mm'
      : s.unit === 'month'
        ? 'MMM'
        : s.unit === 'year'
          ? 'YYYY'
          : 'MMM D';
  const subFmt = s.unit === 'ms' ? 'MMMM D, YYYY' : s.unit === 'year' ? undefined : 'YYYY';
  let prevSub: string | undefined;
  for (let t = firstTick(t0, s, tz); t <= t1 && out.length < 200; t = next(t, s, tz)) {
    const sub = subFmt ? fmt(t, subFmt) : undefined;
    out.push({ t, label: fmt(t, label), ...(sub !== undefined && sub !== prevSub ? { sub } : {}) });
    prevSub = sub;
  }
  return out;
}

/** Rough width (px) of a tick label at the axis font size (left-anchored at the tick, 3 px inset). */
function labelWidth(tk: TimeTick): number {
  return 3 + Math.max(tk.label.length, tk.sub?.length ?? 0) * 6.5;
}

/**
 * Drops ticks whose label would run past `limit` (px, the chart's right edge) so the last label is
 * never clipped ("14:" for "14:00"): Kibana ends on 13:00 over an 8 h range. `posOf` maps a time to x.
 */
export function fitTimeTicks(ticks: TimeTick[], posOf: (t: number) => number, limit: number): TimeTick[] {
  const kept = ticks.filter((tk) => posOf(tk.t) + labelWidth(tk) <= limit);
  // A dropped first tick would take the date row with it; hand its sub-label to the next tick.
  if (kept.length > 0 && kept[0] !== ticks[0] && ticks[0].sub && !kept[0].sub) {
    kept[0] = { ...kept[0], sub: ticks[0].sub };
  }
  return kept;
}

/**
 * Position of instant `t` in bucket units (0 = the first bucket's left edge, 1.5 = the middle of the
 * second): linear inside each bucket, so months and DST days of different length, drawn equally wide,
 * keep their ticks and events in the right place. `end` is the last bucket's end.
 */
export function bucketPos(xs: Array<string | number>, end: number, t: number): number {
  const n = xs.length;
  if (n === 0) {
    return 0;
  }
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (Number(xs[mid]) <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const a = Number(xs[lo]);
  const len = (lo + 1 < n ? Number(xs[lo + 1]) : end) - a;
  return len > 0 ? lo + (t - a) / len : lo;
}

/** Inverse of `bucketPos`. */
export function bucketTimeAt(xs: Array<string | number>, end: number, pos: number): number {
  const n = xs.length;
  if (n === 0) {
    return 0;
  }
  const i = Math.min(n - 1, Math.max(0, Math.floor(pos)));
  const a = Number(xs[i]);
  return a + (pos - i) * ((i + 1 < n ? Number(xs[i + 1]) : end) - a);
}

/** Tooltip header for a time bucket (Kibana: the full date and time). */
export function tooltipTime(t: number, stepMs: number, tz?: TimeZone): string {
  return formatInZone(t, stepMs > 0 && stepMs < MIN ? 'MMM D, YYYY @ HH:mm:ss' : 'MMM D, YYYY @ HH:mm', tz);
}
