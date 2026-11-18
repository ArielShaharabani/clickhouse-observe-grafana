import { rangeUtil, TimeRange } from '@grafana/data';

/**
 * Typed time shorthand for the Discover time picker (DISC-TIME-01): `-7d`, `td`, `yd`, `tw`, `tm`, `ty`.
 * Units s/h/d/w/y are case-insensitive; `m` (minutes) and `M` (months) are not.
 */
const UNIT_RE = /^(?:now)?-(\d+)([smMhHdDwWyYSY])$/;

const NAMED = new Map<string, { from: string; to: string }>([
  ['td', { from: 'now/d', to: 'now/d' }],
  ['yd', { from: 'now-1d/d', to: 'now-1d/d' }],
  ['tw', { from: 'now/w', to: 'now/w' }],
  ['tm', { from: 'now/M', to: 'now/M' }],
  ['ty', { from: 'now/y', to: 'now/y' }],
]);

/** Parse shorthand to a resolved TimeRange; null when the text is not a known, valid shorthand. */
export function parseTimeShorthand(input: string): TimeRange | null {
  const text = input.trim();
  let raw = NAMED.get(text.toLowerCase());
  if (!raw) {
    const m = UNIT_RE.exec(text);
    if (!m || Number(m[1]) === 0) {
      return null;
    }
    const unit = m[2] === 'm' || m[2] === 'M' ? m[2] : m[2].toLowerCase();
    raw = { from: `now-${m[1]}${unit}`, to: 'now' };
  }
  try {
    const range = rangeUtil.convertRawToRange(raw);
    // An overflowing count (`-99999999999999y`) yields an invalid or empty window.
    return range.from.isValid() && range.to.isValid() && range.from.valueOf() < range.to.valueOf() ? range : null;
  } catch {
    return null;
  }
}

/**
 * Compact window length for the picker badge, e.g. `~17h`, `~7d`, `~45m`. The larger unit is used
 * from 2 of it (or exactly 1), so 36h stays `~36h` and 90m stays `~90m`.
 */
export function formatDurationBadge(ms: number): string {
  // Whole-day ranges end at 23:59:59.999; round to the second so `td` reads ~1d, not ~24h.
  const abs = ms < 1000 ? Math.max(0, ms) : Math.round(ms / 1000) * 1000;
  const units: Array<[string, number]> = [
    ['y', 365 * 86400000],
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000],
  ];
  for (const [label, size] of units) {
    if (abs >= 2 * size || abs === size) {
      return `~${Math.round(abs / size)}${label}`;
    }
  }
  return abs >= 1000 ? `~${Math.round(abs / 1000)}s` : `~${Math.round(abs)}ms`;
}
