/**
 * Time-axis ticks for the Visualize XY chart (Kibana parity): ticks on round local times (every
 * 5 minutes, hour, 3 hours, day, month…), a short label per tick and a second row with the date
 * under the first tick and wherever the date changes. Pure (browser time zone via `Date`), used only
 * by `XyChart`; Discover's histogram has its own axis.
 */
import { dateTime } from '@grafana/data';

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

/** First tick at or after `t` for a step, on a round local time. */
function firstTick(t: number, s: Step): number {
  const d = new Date(t);
  if (s.unit === 'ms') {
    // Align within the local day, so 3-hour ticks fall on 00, 03, 06… local time.
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    return day + Math.ceil((t - day) / s.n) * s.n;
  }
  if (s.unit === 'day' || s.unit === 'week') {
    const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (m.getTime() < t) {
      m.setDate(m.getDate() + 1);
    }
    if (s.unit === 'week') {
      // Mondays.
      while (m.getDay() !== 1) {
        m.setDate(m.getDate() + 1);
      }
    } else if (s.n > 1) {
      while ((m.getDate() - 1) % s.n !== 0) {
        m.setDate(m.getDate() + 1);
      }
    }
    return m.getTime();
  }
  if (s.unit === 'month') {
    const m = new Date(d.getFullYear(), d.getMonth(), 1);
    if (m.getTime() < t) {
      m.setMonth(m.getMonth() + 1);
    }
    while (m.getMonth() % s.n !== 0) {
      m.setMonth(m.getMonth() + 1);
    }
    return m.getTime();
  }
  const y = new Date(d.getFullYear(), 0, 1);
  if (y.getTime() < t) {
    y.setFullYear(y.getFullYear() + 1);
  }
  while (y.getFullYear() % s.n !== 0) {
    y.setFullYear(y.getFullYear() + 1);
  }
  return y.getTime();
}

function next(t: number, s: Step): number {
  if (s.unit === 'ms') {
    const n = t + s.n;
    // Re-align after a DST change inside the day (local midnight + k·step).
    return s.n < D ? firstTick(n, s) : n;
  }
  if (s.unit === 'day' || s.unit === 'week') {
    // The next local midnight that qualifies (n-day steps restart on the 1st of each month).
    return firstTick(t + 1, s);
  }
  const d = new Date(t);
  if (s.unit === 'month') {
    d.setMonth(d.getMonth() + s.n);
  } else {
    d.setFullYear(d.getFullYear() + s.n);
  }
  return d.getTime();
}

/**
 * Ticks over [t0, t1] (ms): at most `maxTicks`, on round local times. Labels: `HH:mm` (`HH:mm:ss`
 * under a minute) with the date (`MMMM D, YYYY`) below the first tick and at each new day; days and
 * weeks `MMM D` with the year below; months `MMM` with the year; years `YYYY`.
 */
export function timeTicks(t0: number, t1: number, maxTicks: number): TimeTick[] {
  if (!(t1 > t0) || !Number.isFinite(t0) || !Number.isFinite(t1)) {
    return [];
  }
  const s = timeStep(t0, t1, maxTicks);
  const out: TimeTick[] = [];
  const fmt = (t: number, f: string) => dateTime(t).format(f);
  const label = s.unit === 'ms' ? (s.n < MIN ? 'HH:mm:ss' : 'HH:mm') : s.unit === 'month' ? 'MMM' : s.unit === 'year' ? 'YYYY' : 'MMM D';
  const subFmt = s.unit === 'ms' ? 'MMMM D, YYYY' : s.unit === 'year' ? undefined : 'YYYY';
  let prevSub: string | undefined;
  for (let t = firstTick(t0, s); t <= t1 && out.length < 200; t = next(t, s)) {
    const sub = subFmt ? fmt(t, subFmt) : undefined;
    out.push({ t, label: fmt(t, label), ...(sub !== undefined && sub !== prevSub ? { sub } : {}) });
    prevSub = sub;
  }
  return out;
}

/** Tooltip header for a time bucket (Kibana: the full date and time). */
export function tooltipTime(t: number, stepMs: number): string {
  return dateTime(t).format(stepMs > 0 && stepMs < MIN ? 'MMM D, YYYY @ HH:mm:ss' : 'MMM D, YYYY @ HH:mm');
}
