/**
 * Dimension editing (spec LENS-DIM-01 / LENS-DIM-02): pure helpers behind the dimension editor.
 */
import { metricOptionsOf } from './metricOptions';
import { BASE_OPS, BaseOp, CALC_OPS, clampWindow, CUMULATIVE_BASE_OPS, DEFAULT_WINDOW, isCalcOp, MetricRef } from './calc';
import {
  BucketDim,
  cleanDateHistogram,
  cleanFilters,
  cleanRange,
  cleanTerms,
  DateHistogramDim,
  FilterSpec,
  RangeDim,
  clampPercentile,
  cleanRankValue,
  DEFAULT_PERCENTILE,
  hasRef,
  LensField,
  LensState,
  MAX_NAME,
  MetricDim,
  MetricOp,
  newDimId,
  TermsDim,
} from './state';
import { addTimeBucket, isLensField, LensContext, switchChart } from './suggest';

/** Quick functions, in the editor grid's order (alphabetical, as in Kibana). */
export const QUICK_FUNCTIONS: MetricOp[] = [...BASE_OPS];
/** Time-series calculations (LENS-CALC-01): the grid's "Calculations" group; they need a date histogram. */
export const CALC_FUNCTIONS: MetricOp[] = [...CALC_OPS];

const NUMERIC_OPS: ReadonlySet<MetricOp> = new Set([
  'median',
  'avg',
  'sum',
  'min',
  'max',
  'percentile',
  'percentile_rank',
  'std_dev',
  'last_value',
  'counter_rate',
]);

/**
 * Fields a function can use: none for count (and for the calculations that wrap another metric —
 * their inner metric has the field), numbers for numeric aggregates, any scalar for unique count.
 */
export function compatibleFields(op: MetricOp, fields: LensField[]): LensField[] {
  if (op === 'count' || hasRef(op) || op === 'formula') {
    return [];
  }
  const scalar = fields.filter((f) => f.type !== 'records' && isLensField(f));
  return NUMERIC_OPS.has(op) ? scalar.filter((f) => f.type === 'number') : scalar;
}

/** Fields a "Top values" bucket can split on (scalar, not time, not Records). */
export function bucketFields(fields: LensField[]): LensField[] {
  return fields.filter((f) => f.type !== 'records' && f.type !== 'time' && isLensField(f));
}

/** Fields a date histogram can bucket (date / time fields). */
export function dateFields(fields: LensField[]): LensField[] {
  return fields.filter((f) => f.type === 'time');
}

const newId = newDimId;

/**
 * Changes a metric's function, keeping its field where the new function accepts it (LENS-DIM-02
 * acceptance), else picking the first compatible field. Returns undefined when the function needs a
 * field and none is compatible.
 */
export function withOp(m: MetricDim, op: MetricOp, fields: LensField[]): MetricDim | undefined {
  if (op === 'count') {
    return { kind: 'metric', id: m.id, op, name: m.name, ...metricOptionsOf(m) };
  }
  if (hasRef(op)) {
    // The metric so far becomes what is calculated on ("Median of x" → "Moving average of Median of x").
    const ref = refForCalc(currentRef(m), op, fields);
    return {
      kind: 'metric',
      id: m.id,
      op,
      ref,
      ...(op === 'moving_average' ? { window: clampWindow(m.window ?? DEFAULT_WINDOW) } : {}),
      name: m.name,
      ...metricOptionsOf(m),
    };
  }
  const ok = compatibleFields(op, fields);
  // Leaving a calculation: its inner metric's field is the one to keep.
  const current = m.field ?? m.ref?.field;
  const keep = ok.find((f) => f.sqlExpr === current) ?? ok[0];
  if (!keep) {
    return undefined;
  }
  return {
    kind: 'metric',
    id: m.id,
    op,
    field: keep.sqlExpr,
    fieldLabel: keep.label,
    numeric: keep.type === 'number',
    percentile: op === 'percentile' ? clampPercentile(m.percentile ?? DEFAULT_PERCENTILE) : undefined,
    rankValue: op === 'percentile_rank' ? cleanRankValue(m.rankValue ?? m.ref?.rankValue) : undefined,
    name: m.name,
    ...metricOptionsOf(m),
  };
}

/** What a metric computes, as a calculation's inner metric (count for a formula / no field). */
function currentRef(m: MetricDim): MetricRef {
  if (m.ref) {
    return m.ref;
  }
  if (m.op === 'counter_rate' && m.field) {
    return { op: 'max', field: m.field, fieldLabel: m.fieldLabel, numeric: m.numeric };
  }
  if (m.op === 'formula' || m.op === 'count' || isCalcOp(m.op) || !m.field) {
    return { op: 'count' };
  }
  const r: MetricRef = { op: m.op as BaseOp, field: m.field, fieldLabel: m.fieldLabel, numeric: m.numeric };
  if (m.op === 'percentile') {
    r.percentile = clampPercentile(m.percentile ?? DEFAULT_PERCENTILE);
  }
  if (m.op === 'percentile_rank') {
    r.rankValue = cleanRankValue(m.rankValue);
  }
  return r;
}

/** The inner metric a calculation can use: Cumulative sum only adds counts or sums (of the same field). */
function refForCalc(r: MetricRef, op: MetricOp, fields: LensField[]): MetricRef {
  if (op !== 'cumulative_sum' || CUMULATIVE_BASE_OPS.includes(r.op)) {
    return r;
  }
  const f = fields.find((x) => x.sqlExpr === r.field && x.type === 'number');
  return f ? { op: 'sum', field: f.sqlExpr, fieldLabel: f.label, numeric: true } : { op: 'count' };
}

/**
 * Changes the inner metric's function of a calculation, keeping its field where the function
 * accepts it, else the first compatible one; undefined when none is compatible.
 */
export function withRefOp(m: MetricDim, op: BaseOp, fields: LensField[]): MetricDim | undefined {
  if (op === 'count') {
    return { ...m, ref: { op: 'count' } };
  }
  const ok = compatibleFields(op, fields);
  const keep = ok.find((f) => f.sqlExpr === m.ref?.field) ?? ok[0];
  if (!keep) {
    return undefined;
  }
  const ref: MetricRef = { op, field: keep.sqlExpr, fieldLabel: keep.label, numeric: keep.type === 'number' };
  if (op === 'percentile') {
    ref.percentile = clampPercentile(m.ref?.percentile ?? DEFAULT_PERCENTILE);
  }
  if (op === 'percentile_rank') {
    ref.rankValue = cleanRankValue(m.ref?.rankValue);
  }
  return { ...m, ref };
}

/** Sets the inner metric's field of a calculation. */
export function withRefField(m: MetricDim, field: LensField): MetricDim {
  const ref = m.ref ?? { op: 'count' as const };
  return { ...m, ref: { ...ref, field: field.sqlExpr, fieldLabel: field.label, numeric: field.type === 'number' } };
}

/** Sets the inner metric's percentile (1–99). */
export function withRefPercentile(m: MetricDim, p: number): MetricDim {
  return m.ref ? { ...m, ref: { ...m.ref, percentile: clampPercentile(p) } } : m;
}

/** Sets the inner metric's percentile rank value. */
export function withRefRankValue(m: MetricDim, v: number): MetricDim {
  return m.ref ? { ...m, ref: { ...m.ref, rankValue: cleanRankValue(v) } } : m;
}

/** Sets a Moving average's window (1–100). */
export function withWindow(m: MetricDim, w: number): MetricDim {
  return { ...m, window: clampWindow(w) };
}

/** Sets a metric's field (must be compatible with its function). */
export function withMetricField(m: MetricDim, field: LensField): MetricDim {
  return { ...m, field: field.sqlExpr, fieldLabel: field.label, numeric: field.type === 'number' };
}

/** Sets a bucket's field (top values: any bucket field; date histogram: a date field). */
export function withBucketField(b: BucketDim, field: LensField): BucketDim {
  if (b.kind === 'date_histogram') {
    return field.type === 'time' ? cleanDateHistogram({ ...b, field: field.sqlExpr, label: field.label }) : b;
  }
  if (b.kind === 'range') {
    return field.type === 'number' ? { ...b, field: field.sqlExpr, label: field.label, numeric: true } : b;
  }
  return b.kind === 'terms' ? { ...b, field: field.sqlExpr, label: field.label } : b;
}

/** Applies date histogram options (LENS-DIM-05), normalised like URL input (invalid interval → auto). */
export function withDateOptions(
  b: BucketDim,
  patch: Partial<Pick<DateHistogramDim, 'interval' | 'emptyRows' | 'dropPartial' | 'unbound'>>
): BucketDim {
  return b.kind === 'date_histogram' ? cleanDateHistogram({ ...b, ...patch }) : b;
}

/** A user-edited name; blank = back to the automatic label. */
export function withName<D extends BucketDim | MetricDim>(d: D, name: string): D {
  const trimmed = name.slice(0, MAX_NAME);
  return { ...d, name: trimmed.trim() ? trimmed : undefined };
}

export function withSize(b: BucketDim, size: number): BucketDim {
  return b.kind === 'terms' ? { ...b, size: Math.min(100, Math.max(1, Math.round(size) || 1)) } : b;
}

/** Applies top-values options (LENS-DIM-04); the result is normalised like URL input (defaults dropped, lists capped). */
export function withTermsOptions(b: BucketDim, patch: Partial<Omit<TermsDim, 'kind' | 'id'>>): BucketDim {
  return b.kind === 'terms' ? cleanTerms({ ...b, ...patch }) : b;
}

/** Include / exclude box text (one value or pattern per line) -> list. */
export function parseLines(text: string): string[] {
  return text.split(/\r?\n/).filter((l) => l.length > 0);
}

/** Replaces the dimension with the same id. */
export function replaceDim(s: LensState, d: BucketDim | MetricDim): LensState {
  return d.kind === 'metric'
    ? { ...s, metrics: s.metrics.map((m) => (m.id === d.id ? d : m)) }
    : { ...s, buckets: s.buckets.map((b) => (b.id === d.id ? d : b)) };
}

/** Adds a Count of records metric (the "+ Add" slot of a metric group); returns it for editing. */
export function addMetric(
  s: LensState,
  ctx: LensContext,
  patch: Partial<Pick<MetricDim, 'role'>> = {}
): { state: LensState; id: string } {
  const m: MetricDim = { kind: 'metric', id: newId('m'), op: 'count', ...patch };
  return { state: switchChart({ ...s, metrics: [...s.metrics, m] }, s.chartType, ctx, s.subType), id: m.id };
}

/** Adds a top-values bucket on `field` at the end of the buckets (X first, then Breakdown). */
export function addBucket(
  s: LensState,
  field: LensField,
  ctx: LensContext,
  patch: Pick<BucketDim, 'pivot'> = {}
): { state: LensState; id: string } {
  // A time field buckets by date (like the workspace drop), not by its top values.
  if (field.type === 'time') {
    const state = addTimeBucket(s, field, ctx);
    const date = state.buckets.find((x) => x.kind === 'date_histogram');
    return { state, id: date?.id ?? '' };
  }
  const b: BucketDim = { kind: 'terms', id: newId('b'), field: field.sqlExpr, label: field.label, size: 9, other: true, ...patch };
  return { state: switchChart({ ...s, buckets: [...s.buckets, b] }, s.chartType, ctx, s.subType), id: b.id };
}

/** First field a new "Top values" bucket can use that no bucket uses yet. */
export function nextBucketField(s: LensState, fields: LensField[]): LensField | undefined {
  const used = new Set(s.buckets.map((b) => b.field));
  return bucketFields(fields).find((f) => !used.has(f.sqlExpr));
}

/** A metric for a field dropped on a metric group: median of a number, else unique count. */
export function metricForField(id: string, field: LensField): MetricDim | undefined {
  if (field.type === 'records') {
    return { kind: 'metric', id, op: 'count' };
  }
  if (!isLensField(field)) {
    return undefined;
  }
  const numeric = field.type === 'number';
  return {
    kind: 'metric',
    id,
    op: numeric ? 'median' : 'unique',
    field: field.sqlExpr,
    fieldLabel: field.label,
    numeric,
  };
}

/** Display-only parts (names) removed — what the chart query actually depends on. */
export function queryShape(s: LensState): LensState {
  // Style / Legend (LENS-STYLE-01) never changes the SQL; layers (LENS-LAYER-01) run their own queries.
  // Gauge options (R3-CHARTS) are display-only too.
  const { style: _style, layers: _layers, parked: _parked, gauge: _gauge, ...rest } = s;
  return {
    ...rest,
    // Table pivot (Split metrics by) only reshapes the same rows.
    buckets: s.buckets.map(({ name: _n, pivot: _p, ...b }) => b as BucketDim),
    // Format, colour and axis side are display-only too, and so are the Table / Metric chart options.
    metrics: s.metrics.map(
      ({ name: _n, format: _f, color: _c, axis: _a, role: _r, summary: _s, colorBy: _b, ...m }) => m as MetricDim
    ),
  };
}

/** Bucket functions of the editor (LENS-DIM-05), in Kibana's order. */
export const BUCKET_FUNCTIONS: Array<{ kind: BucketDim['kind']; label: string }> = [
  { kind: 'date_histogram', label: 'Date histogram' },
  { kind: 'range', label: 'Intervals' },
  { kind: 'filters', label: 'Filters' },
  { kind: 'terms', label: 'Top values' },
];

/** Number fields an Intervals bucket can use. */
export function numberFields(fields: LensField[]): LensField[] {
  return fields.filter((f) => f.type === 'number' && isLensField(f));
}

/**
 * Switches a bucket's function, keeping its field where the new function accepts it, else the first
 * compatible field. Undefined when the function needs a field and none is compatible.
 */
export function withBucketFunction(b: BucketDim, kind: BucketDim['kind'], fields: LensField[]): BucketDim | undefined {
  if (b.kind === kind) {
    return b;
  }
  const pick = (list: LensField[]) => list.find((f) => f.sqlExpr === b.field) ?? list[0];
  switch (kind) {
    case 'filters':
      return { kind: 'filters', id: b.id, field: '', label: 'Filters', filters: [{ query: '' }] };
    case 'date_histogram': {
      const f = pick(dateFields(fields));
      return f ? { kind, id: b.id, field: f.sqlExpr, label: f.label, interval: 'auto' } : undefined;
    }
    case 'range': {
      const f = pick(numberFields(fields));
      return f ? { kind, id: b.id, field: f.sqlExpr, label: f.label, numeric: true } : undefined;
    }
    case 'terms': {
      const f = pick(bucketFields(fields));
      return f ? { kind, id: b.id, field: f.sqlExpr, label: f.label, size: 9 } : undefined;
    }
  }
}

/** Applies Intervals options, normalised like URL input. */
export function withRangeOptions(b: BucketDim, patch: Partial<Omit<RangeDim, 'kind' | 'id'>>): BucketDim {
  return b.kind === 'range' ? cleanRange({ ...b, ...patch }) : b;
}

/** Replaces a Filters bucket's list, normalised like URL input. */
export function withFilterList(b: BucketDim, filters: FilterSpec[]): BucketDim {
  return b.kind === 'filters' ? cleanFilters({ ...b, filters }) : b;
}
