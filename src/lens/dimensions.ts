/**
 * Dimension editing (spec LENS-DIM-01 / LENS-DIM-02): pure helpers behind the dimension editor.
 */
import { metricOptionsOf } from './metricOptions';
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
  DEFAULT_PERCENTILE,
  LensField,
  LensState,
  MAX_NAME,
  MetricDim,
  MetricOp,
  newDimId,
  TermsDim,
} from './state';
import { isLensField, LensContext, switchChart } from './suggest';

/** Quick functions, in the editor grid's order. */
export const QUICK_FUNCTIONS: MetricOp[] = ['avg', 'count', 'max', 'median', 'min', 'percentile', 'sum', 'unique'];

const NUMERIC_OPS: ReadonlySet<MetricOp> = new Set(['median', 'avg', 'sum', 'min', 'max', 'percentile']);

/** Fields a function can use: none for count, numbers for numeric aggregates, any scalar for unique count. */
export function compatibleFields(op: MetricOp, fields: LensField[]): LensField[] {
  if (op === 'count') {
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
  const ok = compatibleFields(op, fields);
  const keep = ok.find((f) => f.sqlExpr === m.field) ?? ok[0];
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
    name: m.name,
    ...metricOptionsOf(m),
  };
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
  const b: BucketDim = { kind: 'terms', id: newId('b'), field: field.sqlExpr, label: field.label, size: 9, ...patch };
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
  // Style / Legend (LENS-STYLE-01) never changes the SQL.
  const { style: _style, ...rest } = s;
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
