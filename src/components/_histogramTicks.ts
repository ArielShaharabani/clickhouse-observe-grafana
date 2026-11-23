/**
 * X-axis ticks for the Discover histogram (DISC-CHART-01) — pure, no React.
 *
 * Ticks fall on round times (every 15 minutes, every hour, at midnight, …) chosen so labels never
 * collide at the chart's width, as Kibana's axis does. Sub-day ticks read "HH:mm" with the date as
 * a second line on the first tick and at each new day; day ticks read "1st", "2nd", … with
 * "January 2026" under the first tick and at each new month (Kibana's "1st … 7th / January 2026").
 * Times are in the chosen time zone (utils/timeZone), like every other time in the app.
 */
import { TimeZone } from '@grafana/data';
import { zonedDateTime } from '../utils/timeZone';

export interface AxisTick {
  time: number;
  /** Position across the plot, 0-100. */
  pct: number;
  label: string;
  /** Second line (date or month), or null. */
  subLabel: string | null;
  anchor: 'start' | 'center' | 'end';
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Round tick steps, finest first. */
const STEPS = [
  SEC, 5 * SEC, 10 * SEC, 15 * SEC, 30 * SEC,
  MIN, 5 * MIN, 10 * MIN, 15 * MIN, 30 * MIN,
  HOUR, 2 * HOUR, 3 * HOUR, 6 * HOUR, 12 * HOUR,
  DAY, 2 * DAY, 7 * DAY, 14 * DAY,
];

/** Approximate rendered width (px) of an 11px tabular label. */
const CHAR_PX = 6.5;
/** Minimum clear space between two neighbouring labels. */
const GAP_PX = 16;
/** Minimum distance between ticks, so the axis stays readable (Kibana spaces ticks ~80-120 px). */
const MIN_SPACING_PX = 80;
/** Width of a date / month second line ("Jan 12, 2026", "September 2026"). */
const SUB_LABEL_PX = 90;

function mainFormat(step: number): string {
  if (step >= 28 * DAY) {
    return 'MMM YYYY';
  }
  if (step >= DAY) {
    return 'Do';
  }
  return step < MIN ? 'HH:mm:ss' : 'HH:mm';
}

/** First tick at or after `t0` on a multiple of `step` in local time. */
function firstTick(t0: number, step: number, tz?: TimeZone): number {
  if (step >= DAY) {
    const d = zonedDateTime(t0, tz).startOf('day');
    if (d.valueOf() < t0) {
      d.add(1, 'day');
    }
    return d.valueOf();
  }
  const offset = zonedDateTime(t0, tz).utcOffset() * MIN;
  return Math.ceil((t0 + offset) / step) * step - offset;
}

function nextTick(t: number, step: number, tz?: TimeZone): number {
  // Whole days step by calendar days, so a DST change can't shift midnight ticks to 23:00.
  return step >= DAY ? zonedDateTime(t, tz).add(step / DAY, 'day').valueOf() : t + step;
}

/**
 * Ticks for a linear time axis from `t0` to `t1` drawn `widthPx` wide. Returns an empty list for
 * an empty domain. With an unknown width (0, before the first measure) 600 px is assumed.
 */
export function timeTicks(t0: number, t1: number, widthPx: number, tz?: TimeZone): AxisTick[] {
  const span = t1 - t0;
  if (!(span > 0)) {
    return [];
  }
  const width = widthPx > 0 ? widthPx : 600;
  const step =
    STEPS.find((s) => {
      const spacing = (width * s) / span;
      const labelPx = mainFormat(s).replace('Do', '00th').length * CHAR_PX;
      return spacing >= labelPx + GAP_PX && spacing >= MIN_SPACING_PX;
    }) ?? Math.ceil(span / DAY / Math.max(1, Math.floor(width / MIN_SPACING_PX))) * DAY;
  const fmt = mainFormat(step);
  const ticks: AxisTick[] = [];
  let prevSubPx = -Infinity;
  let prevKey = '';
  for (let t = firstTick(t0, step, tz); t <= t1 && ticks.length < 500; t = nextTick(t, step, tz)) {
    const d = zonedDateTime(t, tz);
    const pct = ((t - t0) / span) * 100;
    const px = (pct / 100) * width;
    // A second line marks a new day (sub-day steps) or a new month (day steps).
    const key = step >= DAY ? d.format('YYYY-MM') : d.format('YYYY-MM-DD');
    let subLabel: string | null = null;
    if (step < 28 * DAY && key !== prevKey && px - prevSubPx >= SUB_LABEL_PX + 10) {
      subLabel = step >= DAY ? d.format('MMMM YYYY') : d.format('MMM D, YYYY');
      prevSubPx = px;
    }
    prevKey = key;
    const label = d.format(fmt);
    const halfPx = (Math.max(label.length * CHAR_PX, subLabel ? SUB_LABEL_PX : 0)) / 2;
    const anchor = px < halfPx ? 'start' : width - px < halfPx ? 'end' : 'center';
    ticks.push({ time: t, pct, label, subLabel, anchor });
  }
  return ticks;
}
