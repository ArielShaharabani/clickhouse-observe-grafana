/**
 * Visualize Style and Legend settings for XY charts (spec LENS-STYLE-01). Chart-level, display-only
 * (never part of the SQL): bar orientation, bar values, per-axis title / gridlines / tick labels /
 * label orientation / scale / bounds, and the legend's visibility, position, alignment and layout.
 * Per-metric value format, colour and axis side live on the metric (LENS-DIM-02, metricOptions.ts).
 *
 * Everything here comes from the URL or a saved chart, so `cleanStyle` keeps only known keys with
 * known values (and finite numbers); unknown input is dropped, never echoed.
 */

export type AxisTitleMode = 'none' | 'auto' | 'custom';
export type TickOrientation = 'horizontal' | 'vertical' | 'angled';
export type AxisScale = 'linear' | 'log' | 'sqrt';
export type AxisBounds = 'full' | 'data' | 'custom';
export type AxisName = 'left' | 'bottom' | 'right';

export interface AxisStyle {
  title?: AxisTitleMode;
  /** Custom title text (title = custom). */
  titleText?: string;
  /** Gridlines from this axis' ticks (default on for left / right, off for bottom). */
  gridlines?: boolean;
  /** Tick labels (default on). */
  ticks?: boolean;
  orientation?: TickOrientation;
  /** Value axes only (left / right). */
  scale?: AxisScale;
  bounds?: AxisBounds;
  min?: number;
  max?: number;
  /** Round the bounds to nice values (default on). */
  nice?: boolean;
}

export type LegendVisibility = 'auto' | 'show' | 'hide';
export type LegendPosition = 'outside' | 'inside';
/** Outside: a side of the chart. Inside: a corner of the plot. */
export type LegendAlignment =
  'right' | 'left' | 'top' | 'bottom' | 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
export type LegendLayout = 'list' | 'grid';

export interface LegendStyle {
  visibility?: LegendVisibility;
  position?: LegendPosition;
  alignment?: LegendAlignment;
  layout?: LegendLayout;
}

export interface LensStyle {
  /** Bar charts only. */
  orientation?: 'vertical' | 'horizontal';
  /** Bar charts only: value labels on bars when there is room. */
  barValues?: 'hide' | 'show';
  left?: AxisStyle;
  bottom?: AxisStyle;
  right?: AxisStyle;
  legend?: LegendStyle;
  /**
   * Series colours chosen from the legend menu, by series name (breakdown value or metric label);
   * `#rrggbb` only. They win over the metric's own colour and the stable automatic colour.
   */
  colors?: Record<string, string>;
}

export const MAX_AXIS_TITLE = 120;
/** At most this many legend colour choices survive the URL; longer series names are dropped. */
export const MAX_SERIES_COLORS = 50;
export const MAX_SERIES_COLOR_KEY = 200;
export const OUTSIDE_ALIGNMENTS: LegendAlignment[] = ['right', 'left', 'top', 'bottom'];
export const INSIDE_ALIGNMENTS: LegendAlignment[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left'];

/** Defaults: what the chart drew before Style / Legend existed (legend below the plot, as a list). */
export const LEGEND_DEFAULTS: Required<LegendStyle> = {
  visibility: 'auto',
  position: 'outside',
  alignment: 'bottom',
  layout: 'list',
};

const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Drops undefined keys; undefined when nothing is left. */
function compact<T extends object>(o: T): T | undefined {
  const out = Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return Object.keys(out).length ? out : undefined;
}

function cleanAxis(x: unknown, valueAxis: boolean): AxisStyle | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const a = x as Record<string, unknown>;
  const title = oneOf(a.title, ['none', 'auto', 'custom'] as const);
  const titleText =
    title === 'custom' && typeof a.titleText === 'string' ? a.titleText.slice(0, MAX_AXIS_TITLE) : undefined;
  const bounds = valueAxis ? oneOf(a.bounds, ['full', 'data', 'custom'] as const) : undefined;
  let min = bounds === 'custom' ? num(a.min) : undefined;
  let max = bounds === 'custom' ? num(a.max) : undefined;
  if (min !== undefined && max !== undefined && min >= max) {
    min = undefined;
    max = undefined;
  }
  return compact<AxisStyle>({
    title,
    titleText,
    gridlines: bool(a.gridlines),
    ticks: bool(a.ticks),
    orientation: oneOf(a.orientation, ['horizontal', 'vertical', 'angled'] as const),
    scale: valueAxis ? oneOf(a.scale, ['linear', 'log', 'sqrt'] as const) : undefined,
    bounds,
    min,
    max,
    nice: valueAxis ? bool(a.nice) : undefined,
  });
}

function cleanLegend(x: unknown): LegendStyle | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const l = x as Record<string, unknown>;
  const position = oneOf(l.position, ['outside', 'inside'] as const);
  const alignment = oneOf(
    l.alignment,
    (position === 'inside' ? INSIDE_ALIGNMENTS : OUTSIDE_ALIGNMENTS) as readonly LegendAlignment[]
  );
  return compact<LegendStyle>({
    visibility: oneOf(l.visibility, ['auto', 'show', 'hide'] as const),
    position,
    alignment,
    layout: oneOf(l.layout, ['list', 'grid'] as const),
  });
}

/** Legend colour choices: string keys up to 200 characters → `#rrggbb`, at most 50 (the rest dropped). */
export function cleanSeriesColors(x: unknown): Record<string, string> | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const entries = Object.entries(x as Record<string, unknown>)
    .filter(([k, v]) => k.length <= MAX_SERIES_COLOR_KEY && typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v))
    .slice(0, MAX_SERIES_COLORS)
    .map(([k, v]) => [k, (v as string).toLowerCase()] as const);
  // fromEntries defines own properties, so a "__proto__" key is just a key.
  return entries.length ? Object.fromEntries(entries) : undefined;
}

/** The colour chosen for a series in the legend, if any (own keys only). */
export function seriesColorOf(style: LensStyle | undefined, name: string): string | undefined {
  const c = style?.colors;
  return c && Object.prototype.hasOwnProperty.call(c, name) ? c[name] : undefined;
}

/** A copy of the style with a series colour set (or removed with `undefined`), kept clean. */
export function withSeriesColor(style: LensStyle | undefined, name: string, color: string | undefined): LensStyle | undefined {
  const colors: Record<string, string> = { ...(style?.colors ?? {}) };
  delete colors[name];
  // The newest choice first, so it survives the cap.
  const next = color ? { [name]: color, ...colors } : colors;
  return cleanStyle({ ...(style ?? {}), colors: next });
}

/** Untrusted input (URL / saved chart) → a well-formed style, or undefined when nothing is set. */
export function cleanStyle(x: unknown): LensStyle | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const s = x as Record<string, unknown>;
  return compact<LensStyle>({
    orientation: oneOf(s.orientation, ['vertical', 'horizontal'] as const),
    barValues: oneOf(s.barValues, ['hide', 'show'] as const),
    left: cleanAxis(s.left, true),
    bottom: cleanAxis(s.bottom, false),
    right: cleanAxis(s.right, true),
    legend: cleanLegend(s.legend),
    colors: cleanSeriesColors(s.colors),
  });
}

/** The legend settings with defaults filled in (alignment matching the position). */
export function legendOf(style: LensStyle | undefined): Required<LegendStyle> {
  const l = { ...LEGEND_DEFAULTS, ...style?.legend };
  const allowed = l.position === 'inside' ? INSIDE_ALIGNMENTS : OUTSIDE_ALIGNMENTS;
  if (!allowed.includes(l.alignment)) {
    l.alignment = l.position === 'inside' ? 'top-right' : 'bottom';
  }
  return l;
}

/** Auto shows the legend unless the chart is a single series without a breakdown (as in Kibana). */
export function legendVisible(style: LensStyle | undefined, seriesCount: number, hasBreakdown: boolean): boolean {
  const v = legendOf(style).visibility;
  return v === 'show' || (v === 'auto' && (seriesCount > 1 || hasBreakdown));
}

/** Axis settings with defaults filled in. */
export function axisOf(
  style: LensStyle | undefined,
  axis: AxisName
): Required<Omit<AxisStyle, 'titleText' | 'min' | 'max'>> & Pick<AxisStyle, 'titleText' | 'min' | 'max'> {
  const a = style?.[axis] ?? {};
  return {
    title: a.title ?? 'auto',
    titleText: a.titleText,
    gridlines: a.gridlines ?? axis !== 'bottom',
    ticks: a.ticks ?? true,
    orientation: a.orientation ?? 'horizontal',
    scale: a.scale ?? 'linear',
    bounds: a.bounds ?? 'full',
    min: a.min,
    max: a.max,
    nice: a.nice ?? true,
  };
}

/** The title an axis shows: none, the custom text, or the automatic one. */
export function axisTitle(style: LensStyle | undefined, axis: AxisName, auto: string): string {
  const a = axisOf(style, axis);
  return a.title === 'none' ? '' : a.title === 'custom' ? (a.titleText ?? '') : auto;
}

/** Rotation (degrees) of tick labels for an orientation. */
export const tickRotation = (o: TickOrientation): number => (o === 'vertical' ? -90 : o === 'angled' ? -45 : 0);

/**
 * Value scale: maps a value to a 0..1 position within [lo, hi]. Log needs positive bounds (values
 * ≤ 0 sit at the bottom); sqrt keeps the sign (√|v|).
 */
export function scalePos(v: number, lo: number, hi: number, scale: AxisScale): number {
  const t = (x: number) =>
    scale === 'log'
      ? Math.log10(Math.max(x, lo > 0 ? lo : 1e-9))
      : scale === 'sqrt'
        ? Math.sign(x) * Math.sqrt(Math.abs(x))
        : x;
  const a = t(lo);
  const b = t(hi);
  return b === a ? 0 : (t(v) - a) / (b - a);
}

export function niceCeil(v: number): number {
  if (v <= 0) {
    return v === 0 ? 1 : -niceCeil(-v) / 10;
  }
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Default number of value-axis ticks aimed for (the step is rounded to 1 / 2 / 5 × 10^n). */
export const TICK_COUNT = 5;

/**
 * Tick step for a value range (d3's tickIncrement): span / count rounded to 1, 2, 5 or 10 × 10^n,
 * as Kibana / Elastic Charts do (0–140 → 20, 0–500 → 100). `integer` (counts) never steps below 1.
 */
export function tickStep(lo: number, hi: number, count = TICK_COUNT, integer = false): number {
  const span = Math.abs(hi - lo);
  if (!(span > 0) || !Number.isFinite(span)) {
    return 1;
  }
  const raw = span / Math.max(1, count);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const e = raw / p;
  const step = (e >= Math.sqrt(50) ? 10 : e >= Math.sqrt(10) ? 5 : e >= Math.SQRT2 ? 2 : 1) * p;
  return integer ? Math.max(1, step) : step;
}

/** Rounds away float noise (0.1 + 0.2) at a step's precision. */
const atStep = (v: number, step: number) => {
  const d = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  return +v.toFixed(Math.min(d, 15));
};

export interface TickOptions {
  /** Ticks aimed for (default 5; fewer on a short plot). */
  count?: number;
  /** All values are whole numbers (counts): no fractional ticks. */
  integer?: boolean;
}

/**
 * Value-axis domain from the data's min / max: Full includes 0, Data hugs the data, Custom uses the
 * given min / max (falling back to the data). Log scales need a positive lower bound. `nice` rounds
 * outward to the next tick step (powers of ten for log): a 140 peak gives 0–140 with steps of 20.
 */
export function valueDomain(
  dataMin: number,
  dataMax: number,
  a: Pick<AxisStyle, 'bounds' | 'min' | 'max' | 'nice' | 'scale'>,
  percentage = false,
  opts: TickOptions = {}
): [number, number] {
  if (percentage) {
    return [dataMin < 0 ? -100 : 0, 100];
  }
  const scale = a.scale ?? 'linear';
  const bounds = a.bounds ?? 'full';
  const nice = a.nice ?? true;
  let lo = bounds === 'full' ? Math.min(0, dataMin) : dataMin;
  let hi = bounds === 'full' ? Math.max(0, dataMax) : dataMax;
  if (bounds === 'custom') {
    lo = a.min ?? lo;
    hi = a.max ?? hi;
  }
  if (scale === 'log') {
    lo = lo > 0 ? lo : Math.min(1, hi > 0 ? hi / 10 : 1);
    hi = hi > lo ? hi : lo * 10;
    if (nice && bounds !== 'custom') {
      lo = Math.pow(10, Math.floor(Math.log10(lo)));
      hi = Math.pow(10, Math.ceil(Math.log10(hi)));
    }
    return [lo, hi];
  }
  if (hi === lo) {
    hi = lo + 1;
  }
  if (nice && bounds !== 'custom') {
    // Two passes: rounding outward can change the span enough to change the step.
    for (let k = 0; k < 2; k++) {
      const step = tickStep(lo, hi, opts.count, opts.integer);
      hi = atStep(Math.ceil(hi / step - 1e-9) * step, step);
      lo = lo < 0 || (bounds === 'data' && lo > 0) ? atStep(Math.floor(lo / step + 1e-9) * step, step) : lo;
    }
  }
  return [lo, hi];
}

/** Tick values for a value axis: powers of ten for log, nice even steps otherwise (in scale space for sqrt). */
export function valueTicks(lo: number, hi: number, scale: AxisScale, opts: TickOptions = {}): number[] {
  if (scale === 'log' && lo > 0) {
    const out: number[] = [];
    for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.floor(Math.log10(hi) + 1e-9) && out.length < 12; e++) {
      out.push(Math.pow(10, e));
    }
    return out.length >= 2 ? out : [lo, hi];
  }
  if (scale === 'sqrt') {
    const t = (x: number) => Math.sign(x) * Math.sqrt(Math.abs(x));
    const inv = (x: number) => Math.sign(x) * x * x;
    const [a, b] = [t(lo), t(hi)];
    return [0, 0.25, 0.5, 0.75, 1].map((f) => inv(a + (b - a) * f));
  }
  const step = tickStep(lo, hi, opts.count, opts.integer);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9 && out.length < 50; v += step) {
    out.push(atStep(v, step));
  }
  return out.length >= 2 ? out : [lo, hi];
}
