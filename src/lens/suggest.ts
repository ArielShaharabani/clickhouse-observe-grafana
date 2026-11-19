/**
 * Suggestion engine (spec LENS-AUTO-01 rules 1–7, LENS-SUGG-01, LENS-TYPE-01 remapping; blueprint
 * "Suggestion engine"). Pure functions over LensState.
 */
import {
  BucketDim,
  CHART_LABELS,
  ChartType,
  DateHistogramDim,
  dimLabel,
  LensField,
  LensState,
  MetricDim,
  newDimId,
  XySubType,
} from './state';

/** The data view's time column (for "metric over time" defaults). Undefined → no time field. */
export interface LensContext {
  timeField?: { sqlExpr: string; label: string };
}

const newId = newDimId;

/** LENS-AUTO-01 rule 2: top values size. */
export const TERMS_SIZE = 9;

const CONTAINER_TYPES = new Set(['map', 'json', 'tuple', 'array']);

/** Whether a field can be added to the workspace (whole Map/JSON/Tuple/Array containers can't). */
export function isLensField(f: LensField): boolean {
  return !CONTAINER_TYPES.has(f.type);
}

function dateDim(field: string, label: string): DateHistogramDim {
  return { kind: 'date_histogram', id: newId('b'), field, label, interval: 'auto' };
}

function countMetric(): MetricDim {
  return { kind: 'metric', id: newId('m'), op: 'count' };
}

const XY: ReadonlySet<ChartType> = new Set(['line', 'area', 'bar']);
export const isXy = (t: ChartType) => XY.has(t);

/** Top suggestion for a set of dimensions: no bucket → Metric; date on X → Line; else Bar. */
export function chooseChart(buckets: BucketDim[]): ChartType {
  if (buckets.length === 0) {
    return 'metric';
  }
  return buckets[0].kind === 'date_histogram' ? 'line' : 'bar';
}

function withDefaults(s: LensState): LensState {
  return isXy(s.chartType) && !s.subType ? { ...s, subType: 'stacked' } : s;
}

/**
 * Adds a field to the workspace and picks the chart (LENS-AUTO-01): date → date histogram on X;
 * number → median metric; Records → count; anything else → top 9 values. A second bucket becomes
 * the breakdown (rule 4), a further metric is appended (rule 5), and a metric with no bucket goes
 * over time when there is a time field (rule 1).
 */
export function addField(state: LensState, field: LensField, ctx: LensContext): LensState {
  if (!isLensField(field)) {
    return state;
  }
  let buckets = [...state.buckets];
  let metrics = [...state.metrics];

  if (field.type === 'records') {
    if (!metrics.some((m) => m.op === 'count')) {
      metrics.push(countMetric());
    }
  } else if (field.type === 'time') {
    return addTimeBucket(state, field, ctx);
  } else if (field.type === 'number') {
    if (metrics.some((m) => m.op === 'median' && m.field === field.sqlExpr)) {
      return state;
    }
    metrics.push({
      kind: 'metric',
      id: newId('m'),
      op: 'median',
      field: field.sqlExpr,
      fieldLabel: field.label,
      numeric: true,
    });
  } else {
    if (!buckets.some((b) => b.kind === 'terms' && b.field === field.sqlExpr)) {
      buckets.push({ kind: 'terms', id: newId('b'), field: field.sqlExpr, label: field.label, size: TERMS_SIZE });
    }
  }

  // Rule 1: a metric alone goes over time.
  if (buckets.length === 0 && metrics.length > 0 && ctx.timeField) {
    buckets = [dateDim(ctx.timeField.sqlExpr, ctx.timeField.label)];
  }
  // A bucket needs something to measure.
  if (metrics.length === 0 && buckets.length > 0) {
    metrics = [countMetric()];
  }
  const wasEmpty = state.buckets.length === 0 && state.metrics.length === 0;
  // First field: the top suggestion picks the chart. Later fields keep the user's chart type and
  // sub-type (LENS-TYPE-01: the user's choice isn't silently replaced), within what it can hold.
  if (wasEmpty) {
    return withDefaults({ chartType: chooseChart(buckets), buckets, metrics });
  }
  // XY holds X + Breakdown; a third bucket replaces the breakdown.
  if (isXy(state.chartType) && buckets.length > 2) {
    buckets = [buckets[0], buckets[buckets.length - 1]];
  }
  return switchChart({ ...state, buckets, metrics }, state.chartType, ctx, state.subType);
}

/**
 * Switches chart type, remapping dimensions instead of discarding them (LENS-TYPE-01): metrics and
 * buckets carry over in order; a time-based XY type with no date bucket gets one on X; anything
 * the target can't hold is dropped. The layer is never cleared.
 */
/** Charts that can show a date histogram. */
const showsTime = (t: ChartType) => isXy(t) || t === 'table';

/**
 * A time field on the workspace or a bucket slot: a date histogram, first. On a chart that can't show
 * time (Metric, Pie) it switches to the chart the user came from (or a line chart, LENS-AUTO-01) —
 * like Kibana, where dropping a date field picks a suggestion that can use it — and a date
 * histogram parked by an earlier switch comes back instead of a new one.
 */
export function addTimeBucket(state: LensState, field: LensField, ctx: LensContext): LensState {
  const parkedDate = state.parked?.buckets.some((b) => b.kind === 'date_histogram');
  let buckets = [...state.buckets];
  if (!parkedDate && !buckets.some((b) => b.kind === 'date_histogram')) {
    buckets = [dateDim(field.sqlExpr, field.label), ...buckets];
  }
  const metrics = state.metrics.length > 0 ? state.metrics : [countMetric()];
  if (state.buckets.length === 0 && state.metrics.length === 0 && !state.parked) {
    return withDefaults({ chartType: chooseChart(buckets), buckets, metrics });
  }
  const target = showsTime(state.chartType)
    ? state.chartType
    : state.parked && showsTime(state.parked.chartType)
      ? state.parked.chartType
      : 'line';
  return switchChart({ ...state, buckets, metrics }, target, ctx, state.subType ?? state.parked?.subType);
}

export function switchChart(state: LensState, target: ChartType, ctx: LensContext, subType?: XySubType): LensState {
  const parked = state.parked;
  // Bring back what an earlier switch parked (a date histogram returns to X, the rest after).
  let buckets = [...state.buckets];
  if (parked && parked.buckets.length > 0) {
    const have = new Set(buckets.map((b) => b.id));
    const hasDate = buckets.some((b) => b.kind === 'date_histogram');
    const back = parked.buckets.filter((b) => !have.has(b.id) && !(hasDate && b.kind === 'date_histogram'));
    buckets = [
      ...back.filter((b) => b.kind === 'date_histogram'),
      ...buckets,
      ...back.filter((b) => b.kind !== 'date_histogram'),
    ];
  }
  const offered = buckets;
  let metrics = [...state.metrics];
  switch (target) {
    case 'line':
    case 'area':
      if (!buckets.some((b) => b.kind === 'date_histogram') && ctx.timeField) {
        buckets = [dateDim(ctx.timeField.sqlExpr, ctx.timeField.label), ...buckets];
      }
      buckets = buckets.slice(0, 2);
      break;
    case 'bar':
      // A bar with nothing on X is a bar over time (rule 3).
      if (buckets.length === 0 && ctx.timeField) {
        buckets = [dateDim(ctx.timeField.sqlExpr, ctx.timeField.label)];
      }
      buckets = buckets.slice(0, 2);
      break;
    case 'metric': {
      // Primary + secondary metric (+ a Maximum value, LENS-CHART-01); one "Break down by" (a category, not time).
      buckets = buckets.filter((b) => b.kind !== 'date_histogram').slice(0, 1);
      const max = metrics.find((m) => m.role === 'max');
      metrics = [...metrics.filter((m) => m.role !== 'max').slice(0, 2), ...(max ? [max] : [])];
      break;
    }
    case 'pie':
      // One "Slice by" (nested slices need a sunburst Grafana doesn't ship).
      buckets = buckets.filter((b) => b.kind !== 'date_histogram').slice(0, 1);
      metrics = metrics.slice(0, 1);
      break;
    case 'table':
      break;
  }
  // Chart-specific roles (LENS-CHART-01) only mean something on their own chart type.
  if (target !== 'table') {
    buckets = buckets.map(({ pivot: _p, ...b }) => b as BucketDim);
  }
  if (target !== 'metric') {
    metrics = metrics.map(({ role: _r, ...m }) => m as MetricDim);
  }
  if (metrics.every((m) => m.role === 'max')) {
    metrics = [countMetric(), ...metrics];
  }
  const next: LensState = { chartType: target, buckets, metrics };
  // Style and layers (LENS-STYLE-01, LENS-LAYER-01) only draw on XY charts; parked otherwise.
  const style = isXy(state.chartType) ? state.style : parked?.style;
  const layers = isXy(state.chartType) ? state.layers : parked?.layers;
  if (isXy(target)) {
    next.subType = subType ?? state.subType ?? parked?.subType ?? 'stacked';
    if (style) {
      next.style = style;
    }
    if (layers) {
      next.layers = layers;
    }
  }
  // Park what the target can't show, so switching back restores it (Kibana keeps unused columns).
  const kept = new Set(buckets.map((b) => b.id));
  const dropped = offered.filter((b) => !kept.has(b.id) && (b.kind === 'date_histogram' || !showsTime(target)));
  const parkStyle = isXy(target) ? undefined : style;
  const parkLayers = isXy(target) ? undefined : layers;
  if (dropped.length > 0 || parkStyle || parkLayers) {
    const from = isXy(state.chartType) ? state.chartType : (parked?.chartType ?? state.chartType);
    const fromSub = isXy(state.chartType) ? state.subType : parked?.subType;
    next.parked = {
      chartType: from,
      ...(fromSub ? { subType: fromSub } : {}),
      buckets: dropped.map(({ pivot: _p, ...b }) => b as BucketDim),
      ...(parkStyle ? { style: parkStyle } : {}),
      ...(parkLayers ? { layers: parkLayers } : {}),
    };
  }
  return next;
}

export interface Suggestion {
  title: string;
  state: LensState;
  current?: boolean;
}

/** Cards for the suggestions strip (LENS-SUGG-01), current visualization first, no duplicates. */
export function suggestions(state: LensState, ctx: LensContext): Suggestion[] {
  if (state.metrics.length === 0 && state.buckets.length === 0) {
    return [];
  }
  const out: Suggestion[] = [{ title: 'Current visualization', state, current: true }];
  const add = (title: string, s: LensState) => out.push({ title, state: s });
  const [b0, b1] = state.buckets;
  const hasDate = state.buckets.some((b) => b.kind === 'date_histogram');
  const hasTerms = state.buckets.some((b) => b.kind === 'terms');

  // A single number per metric (rule 6).
  for (const m of state.metrics) {
    add(dimLabel(m), switchChart({ ...state, metrics: [m] }, 'metric', ctx));
  }
  if (hasDate) {
    add('Area stacked', switchChart(state, 'area', ctx, 'stacked'));
    add('Line', switchChart(state, 'line', ctx));
    add('Bar percentage', switchChart(state, 'bar', ctx, 'percentage'));
  }
  if (hasTerms) {
    add('Bar percentage', switchChart(state, 'bar', ctx, 'percentage'));
    add('Pie', switchChart(state, 'pie', ctx));
    add('Table', switchChart(state, 'table', ctx));
  }
  // Flip: swap X and breakdown (rule 6) — category × category only; a date breakdown would turn
  // every time bucket into its own series.
  if (b0?.kind === 'terms' && b1?.kind === 'terms') {
    const flipped: LensState = { ...state, buckets: [b1, b0] };
    add(`${b0.label} for each ${b1.label}`, {
      ...flipped,
      chartType: chooseChart(flipped.buckets),
      subType: state.subType ?? 'stacked',
    });
  }
  // Drop duplicates (same state as an earlier card), keeping the first.
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = JSON.stringify({
      c: s.state.chartType,
      t: s.state.subType,
      b: s.state.buckets.map((b) => b.id),
      m: s.state.metrics.map((m) => m.id),
    });
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/** Human title of a state's chart, e.g. "Bar stacked", "Line", "Metric". */
export function chartTitle(s: LensState): string {
  return s.subType && isXy(s.chartType) && s.chartType !== 'line'
    ? `${CHART_LABELS[s.chartType]} ${s.subType}`
    : CHART_LABELS[s.chartType];
}
