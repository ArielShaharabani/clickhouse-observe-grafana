import { rangeUtil, TimeRange } from '@grafana/data';

/** Typed time shorthand for the Discover time picker (DISC-TIME-01): `-7d`, `td`, `yd`, `tw`, `tm`, `ty`. */
const UNIT_RE = /^(?:now)?-(\d+)([smhdwMy])$/;

const NAMED: Record<string, { from: string; to: string }> = {
  td: { from: 'now/d', to: 'now/d' },
  yd: { from: 'now-1d/d', to: 'now-1d/d' },
  tw: { from: 'now/w', to: 'now/w' },
  tm: { from: 'now/M', to: 'now/M' },
  ty: { from: 'now/y', to: 'now/y' },
};

/** Parse shorthand to a resolved TimeRange; null when the text is not a known shorthand. */
export function parseTimeShorthand(input: string): TimeRange | null {
  const text = input.trim();
  const named = NAMED[text.toLowerCase()];
  let raw: { from: string; to: string } | undefined = named;
  if (!raw) {
    const m = UNIT_RE.exec(text);
    if (!m || Number(m[1]) === 0) {
      return null;
    }
    raw = { from: `now-${m[1]}${m[2]}`, to: 'now' };
  }
  try {
    return rangeUtil.convertRawToRange(raw);
  } catch {
    return null;
  }
}

/** Compact window length for the picker badge, e.g. `~17h`, `~7d`, `~45m`. */
export function formatDurationBadge(ms: number): string {
  // Whole-day ranges end at 23:59:59.999; round to the second so `td` reads ~1d, not ~24h.
  const abs = ms < 1000 ? Math.max(0, ms) : Math.round(ms / 1000) * 1000;
  const units: Array<[string, number]> = [
    ['y', 365 * 86400000],
    ['d', 86400000],
    ['h', 3600000],
    ['m', 60000],
    ['s', 1000],
  ];
  for (const [label, size] of units) {
    if (abs >= size) {
      return `~${Math.round(abs / size)}${label}`;
    }
  }
  return `~${Math.round(abs)}ms`;
}
