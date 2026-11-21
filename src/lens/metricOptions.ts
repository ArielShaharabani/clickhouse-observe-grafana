/**
 * Metric dimension advanced and appearance options (spec LENS-DIM-02 "Advanced" / "Appearance",
 * PLAN 16g): Filter by, Time shift, Reduced time range, Normalize by unit, Value format, Series
 * colour, Axis side.
 *
 * Everything here arrives from the URL / a saved chart, so it is untrusted: shift and reduced range
 * are parsed into an integer and a unit from a fixed list (SQL is printed from those, never from the
 * text), a colour must be `#rrggbb`, enums are checked, and the KQL filter is compiled by the same
 * KQL compiler as the search bar (escaped values, resolved fields).
 */

export type TimeUnit = 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y';

export interface TimeSpan {
  n: number;
  unit: TimeUnit;
}

/** ClickHouse interval keyword per unit (printed by us; `n` is an integer we parsed). */
export const CH_UNIT: Record<TimeUnit, string> = {
  s: 'SECOND',
  m: 'MINUTE',
  h: 'HOUR',
  d: 'DAY',
  w: 'WEEK',
  M: 'MONTH',
  y: 'YEAR',
};

const UNIT_WORD: Record<TimeUnit, string> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  w: 'week',
  M: 'month',
  y: 'year',
};

/** Approximate length (ms), for ordering and sanity limits only (calendar units are approximations). */
const UNIT_MS: Record<TimeUnit, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  M: 30 * 86_400_000,
  y: 365 * 86_400_000,
};

/** Kibana's time shift presets. */
export const SHIFT_PRESETS = ['3h', '6h', '12h', '1d', '1w', '1M', '3M', '6M'] as const;
/** Kibana's reduced time range presets. */
export const REDUCED_PRESETS = ['30s', '1m', '5m', '15m', '1h'] as const;

/** Longest span accepted (10 years), so a typo can't produce an absurd window. */
const MAX_SPAN_MS = 10 * UNIT_MS.y;

const SPAN_RE = /^([1-9][0-9]{0,4})\s*(s|m|h|d|w|M|y)$/;

/** `"3h"` → {n: 3, unit: 'h'}; anything else (sign, decimals, unknown unit, too long) → null. */
export function parseSpan(text: unknown): TimeSpan | null {
  if (typeof text !== 'string') {
    return null;
  }
  const m = SPAN_RE.exec(text.trim());
  if (!m) {
    return null;
  }
  const n = Number(m[1]);
  const unit = m[2] as TimeUnit;
  return n * UNIT_MS[unit] <= MAX_SPAN_MS ? { n, unit } : null;
}

/** Canonical text of a span (`3h`). */
export const spanText = (s: TimeSpan): string => `${s.n}${s.unit}`;

/** "3 hours", "1 day". */
export const spanWords = (s: TimeSpan): string => `${s.n} ${UNIT_WORD[s.unit]}${s.n === 1 ? '' : 's'}`;

/** A span as a ClickHouse INTERVAL (only our own integer and keyword). */
export const chInterval = (s: TimeSpan): string => `INTERVAL ${Math.floor(s.n)} ${CH_UNIT[s.unit]}`;

export function spanError(text: string): string | null {
  if (!text.trim()) {
    return null;
  }
  return parseSpan(text) ? null : 'Use a whole number and a unit: s, m, h, d, w, M (month) or y — e.g. 3h, 1w';
}

// ── Normalize by unit ──────────────────────────────────────────────────────────────────────────

export type NormalizeUnit = 's' | 'm' | 'h' | 'd';
export const NORMALIZE_UNITS: readonly NormalizeUnit[] = ['s', 'm', 'h', 'd'];
export const NORMALIZE_SECONDS: Record<NormalizeUnit, number> = { s: 1, m: 60, h: 3600, d: 86_400 };
export const NORMALIZE_LABEL: Record<NormalizeUnit, string> = {
  s: 'per second',
  m: 'per minute',
  h: 'per hour',
  d: 'per day',
};

// ── Value format ───────────────────────────────────────────────────────────────────────────────

export type ValueFormatId = 'number' | 'percent' | 'bytes' | 'bits' | 'duration' | 'custom';
export const VALUE_FORMATS: readonly ValueFormatId[] = ['number', 'percent', 'bytes', 'bits', 'duration', 'custom'];
export const VALUE_FORMAT_LABEL: Record<ValueFormatId | 'default', string> = {
  default: 'Default',
  number: 'Number',
  percent: 'Percent',
  bytes: 'Bytes (1024)',
  bits: 'Bits (1000)',
  duration: 'Duration',
  custom: 'Custom format',
};

/** Unit the raw value of a Duration metric is in. */
export type DurationUnit = 'ms' | 's' | 'm' | 'h';
export const DURATION_UNITS: readonly DurationUnit[] = ['ms', 's', 'm', 'h'];

export interface ValueFormat {
  id: ValueFormatId;
  /** Decimals for number / percent / bytes / bits / custom (0–10). */
  decimals?: number;
  /** Duration: unit of the raw value (default ms). */
  durationUnit?: DurationUnit;
  /** Custom: a numeral-style pattern, e.g. `0,0.00`, `0.0a`, `$0,0`, `0.00 req/s`. */
  pattern?: string;
}

export const MAX_PATTERN = 40;

/**
 * A numeral-style pattern: optional literal prefix, a number part (`0`, `0,0`, `0.00`, `0,0.0`,
 * optional trailing `a` = abbreviate 1.2k / 3.4m, optional `%` = ×100), optional literal suffix.
 * Rendering only — the pattern is never evaluated.
 */
const PATTERN_RE = /^([^0#]*)([0#]+(?:,[0#]+)?)(?:\.([0#]+))?(a)?(%)?([^0#]*)$/;

export function patternError(p: string): string | null {
  if (p.length > MAX_PATTERN) {
    return `Max ${MAX_PATTERN} characters`;
  }
  return PATTERN_RE.test(p) ? null : 'Use a pattern like 0,0.00 · 0.0a · $0,0 · 0.0%';
}

const clampDecimals = (d: unknown, dflt: number): number => {
  const n = Number(d);
  return Number.isInteger(n) && n >= 0 && n <= 10 ? n : dflt;
};

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fixed(v: number, decimals: number, grouping: boolean): string {
  const s = Math.abs(v).toFixed(decimals);
  const [i, f] = s.split('.');
  const body = (grouping ? group(i) : i) + (f !== undefined ? `.${f}` : '');
  return v < 0 && Number(s) !== 0 ? `-${body}` : body;
}

function scaled(v: number, base: number, units: string[], decimals: number): string {
  let u = 0;
  let x = Math.abs(v);
  while (x >= base && u < units.length - 1) {
    x /= base;
    u++;
  }
  return `${v < 0 ? '-' : ''}${x.toFixed(decimals)} ${units[u]}`;
}

function duration(v: number, unit: DurationUnit): string {
  const ms = v * { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[unit];
  const a = Math.abs(ms);
  const sign = ms < 0 ? '-' : '';
  if (a < 1000) {
    return `${sign}${Number(a.toFixed(1))} ms`;
  }
  if (a < 60_000) {
    return `${sign}${Number((a / 1000).toFixed(2))} s`;
  }
  if (a < 3_600_000) {
    return `${sign}${Number((a / 60_000).toFixed(1))} min`;
  }
  if (a < 86_400_000) {
    return `${sign}${Number((a / 3_600_000).toFixed(1))} h`;
  }
  return `${sign}${Number((a / 86_400_000).toFixed(1))} d`;
}

function custom(v: number, pattern: string): string {
  const m = PATTERN_RE.exec(pattern);
  if (!m) {
    return String(v);
  }
  const [, prefix, intPart, frac, abbr, pct, suffix] = m;
  let x = pct ? v * 100 : v;
  let tag = '';
  if (abbr) {
    const steps: Array<[number, string]> = [
      [1e12, 't'],
      [1e9, 'b'],
      [1e6, 'm'],
      [1e3, 'k'],
    ];
    const hit = steps.find(([n]) => Math.abs(x) >= n);
    if (hit) {
      x /= hit[0];
      tag = hit[1];
    }
  }
  return `${prefix}${fixed(x, frac?.length ?? 0, intPart.includes(','))}${tag}${pct ? '%' : ''}${suffix}`;
}

/** Display text of a metric value. No format = the chart's default number display. */
export function formatValue(v: number, f: ValueFormat | undefined, fallback: (v: number) => string): string {
  if (!f || !Number.isFinite(v)) {
    return fallback(v);
  }
  switch (f.id) {
    case 'number':
      return fixed(v, clampDecimals(f.decimals, 2), true);
    case 'percent':
      return `${fixed(v * 100, clampDecimals(f.decimals, 2), true)}%`;
    case 'bytes':
      return scaled(v, 1024, ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'], clampDecimals(f.decimals, 1));
    case 'bits':
      return scaled(v, 1000, ['b', 'kb', 'Mb', 'Gb', 'Tb', 'Pb'], clampDecimals(f.decimals, 1));
    case 'duration':
      return duration(v, f.durationUnit ?? 'ms');
    case 'custom':
      return custom(v, f.pattern ?? '0,0.[00]');
  }
}

/**
 * The format a metric is shown with: its own, else the function's default — Percentile rank (and a
 * calculation over one) is a share 0–1 shown as a percent, as Kibana's percentile rank column.
 */
export function formatOf(
  m: { op?: string; format?: ValueFormat; ref?: { op?: string } } | undefined
): ValueFormat | undefined {
  if (!m) {
    return undefined;
  }
  const rank = m.op === 'percentile_rank' || m.ref?.op === 'percentile_rank';
  return m.format ?? (rank ? { id: 'percent', decimals: 2 } : undefined);
}

/** Grafana field config (`unit`, `decimals`) for a value format, for the panels Lens renders / exports. */
export function grafanaUnit(f: ValueFormat | undefined): { unit?: string; decimals?: number } {
  if (!f) {
    return {};
  }
  const decimals = f.decimals === undefined ? undefined : clampDecimals(f.decimals, 2);
  switch (f.id) {
    case 'number':
      return { unit: 'none', decimals: decimals ?? 2 };
    case 'percent':
      return { unit: 'percentunit', decimals };
    case 'bytes':
      return { unit: 'bytes', decimals };
    case 'bits':
      return { unit: 'decbits', decimals };
    case 'duration':
      return { unit: f.durationUnit ?? 'ms' };
    case 'custom': {
      const m = PATTERN_RE.exec(f.pattern ?? '');
      if (!m) {
        return {};
      }
      const [, prefix, , frac, abbr, pct, suffix] = m;
      const d = frac?.length ?? 0;
      if (pct) {
        return { unit: 'percentunit', decimals: d };
      }
      if (prefix.trim()) {
        return { unit: `prefix:${prefix.trim()}`, decimals: d };
      }
      if (suffix.trim()) {
        return { unit: `suffix:${suffix.trimEnd()}`, decimals: d };
      }
      return { unit: abbr ? 'short' : 'none', decimals: d };
    }
  }
}

// ── Colour / axis ──────────────────────────────────────────────────────────────────────────────

export type AxisSide = 'left' | 'auto' | 'right';
export const AXIS_SIDES: readonly AxisSide[] = ['left', 'auto', 'right'];

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const isColor = (c: unknown): c is string => typeof c === 'string' && COLOR_RE.test(c);

// ── Untrusted input ────────────────────────────────────────────────────────────────────────────

export const MAX_FILTER = 1000;

/** The advanced / appearance options a metric can carry (all optional). */
export interface MetricOptions {
  /** Filter by: KQL applied to this metric only. */
  filter?: string;
  /** Time shift, canonical text (`1d`). */
  shift?: string;
  /** Reduced time range, canonical text (`15m`): only the last span of the time range counts. */
  reducedRange?: string;
  /** Normalize by unit: value per second / minute / hour / day of the date bucket. */
  normalize?: NormalizeUnit;
  format?: ValueFormat;
  /** Series colour `#rrggbb` (used when the chart has no breakdown). */
  color?: string;
  /** Axis side (XY charts); 'auto' and undefined = left. */
  axis?: AxisSide;
}

export const METRIC_OPTION_KEYS = ['filter', 'shift', 'reducedRange', 'normalize', 'format', 'color', 'axis'] as const;

function cleanFormat(x: unknown): ValueFormat | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const r = x as Record<string, unknown>;
  if (!VALUE_FORMATS.includes(r.id as ValueFormatId)) {
    return undefined;
  }
  const out: ValueFormat = { id: r.id as ValueFormatId };
  if (r.decimals !== undefined) {
    out.decimals = clampDecimals(r.decimals, 2);
  }
  if (out.id === 'duration' && DURATION_UNITS.includes(r.durationUnit as DurationUnit)) {
    out.durationUnit = r.durationUnit as DurationUnit;
  }
  if (out.id === 'custom') {
    if (typeof r.pattern !== 'string' || patternError(r.pattern)) {
      return undefined;
    }
    out.pattern = r.pattern;
  }
  return out;
}

/** Keeps only the known, well-formed options of untrusted input. */
export function cleanMetricOptions(raw: Record<string, unknown>): MetricOptions {
  const out: MetricOptions = {};
  if (typeof raw.filter === 'string' && raw.filter.trim() && raw.filter.length <= MAX_FILTER) {
    out.filter = raw.filter;
  }
  const shift = parseSpan(raw.shift);
  if (shift) {
    out.shift = spanText(shift);
  }
  const reduced = parseSpan(raw.reducedRange);
  if (reduced) {
    out.reducedRange = spanText(reduced);
  }
  if (NORMALIZE_UNITS.includes(raw.normalize as NormalizeUnit)) {
    out.normalize = raw.normalize as NormalizeUnit;
  }
  const format = cleanFormat(raw.format);
  if (format) {
    out.format = format;
  }
  if (isColor(raw.color)) {
    out.color = raw.color.toLowerCase();
  }
  if (AXIS_SIDES.includes(raw.axis as AxisSide) && raw.axis !== 'auto') {
    out.axis = raw.axis as AxisSide;
  }
  return out;
}

/** The options of a metric, to carry them across a function change. */
export function metricOptionsOf(m: MetricOptions): MetricOptions {
  const out: MetricOptions = {};
  for (const k of METRIC_OPTION_KEYS) {
    if (m[k] !== undefined) {
      (out as Record<string, unknown>)[k] = m[k];
    }
  }
  return out;
}

/** Label suffix for the options that change what is measured ("1d ago", "last 15m", "per hour"). */
export function optionsLabelSuffix(m: MetricOptions): string {
  const parts: string[] = [];
  const reduced = parseSpan(m.reducedRange);
  if (reduced) {
    parts.push(`last ${spanText(reduced)}`);
  }
  const shift = parseSpan(m.shift);
  if (shift) {
    parts.push(`${spanText(shift)} ago`);
  }
  const unit = m.normalize ? ` ${NORMALIZE_LABEL[m.normalize]}` : '';
  return `${unit}${parts.length ? ` (${parts.join(', ')})` : ''}`;
}
