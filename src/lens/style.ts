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
}

export const MAX_AXIS_TITLE = 120;
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

/**
 * Value-axis domain from the data's min / max: Full includes 0, Data hugs the data, Custom uses the
 * given min / max (falling back to the data). Log scales need a positive lower bound. `nice` rounds
 * outward to 1 / 2 / 5 × 10^n (powers of ten for log).
 */
export function valueDomain(
  dataMin: number,
  dataMax: number,
  a: Pick<AxisStyle, 'bounds' | 'min' | 'max' | 'nice' | 'scale'>,
  percentage = false
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
    hi = hi > 0 ? niceCeil(hi) : hi;
    lo = lo < 0 ? -niceCeil(-lo) : bounds === 'data' && lo > 0 ? niceFloor(lo) : lo;
  }
  return [lo, hi];
}

function niceFloor(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.floor(v / p) * p;
}

/** Tick values for a value axis: powers of ten for log, five even steps otherwise (in scale space). */
export function valueTicks(lo: number, hi: number, scale: AxisScale): number[] {
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
  return [0, 0.25, 0.5, 0.75, 1].map((f) => lo + (hi - lo) * f);
}
