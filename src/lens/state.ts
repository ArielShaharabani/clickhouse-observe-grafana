/**
 * Lens state (spec LENS-AUTO-01 / LENS-TYPE-01, docs/spec/20-lens.md; blueprint "LensState").
 *
 * One data layer, kept as two ordered lists instead of per-chart roles: `buckets` (group-by
 * dimensions) and `metrics` (aggregations). Each chart type reads its roles from those lists in
 * order — XY: X = buckets[0], Breakdown = buckets[1]; Table: Rows = buckets; Metric: Break down
 * by = buckets[0]; Pie: slices = buckets — so a chart-type switch is a re-cap of the same lists
 * (LENS-TYPE-01 remapping rules 1–2), never a rebuild.
 */
import { FieldType } from '../sql/fieldModel';

export type ChartType = 'line' | 'area' | 'bar' | 'metric' | 'table' | 'pie';
export type XySubType = 'stacked' | 'percentage' | 'unstacked';

export type MetricOp = 'count' | 'median' | 'avg' | 'sum' | 'min' | 'max' | 'unique';

export interface DateHistogramDim {
  kind: 'date_histogram';
  id: string;
  /** SQL expression of the time column. */
  field: string;
  label: string;
  /** 'auto' ≈ 60 buckets over the time range (same rule as the Discover histogram). */
  interval: 'auto';
}

export interface TermsDim {
  kind: 'terms';
  id: string;
  field: string;
  label: string;
  /** Top N by count (LENS-AUTO-01 rule 2: 9). */
  size: number;
}

export interface MetricDim {
  kind: 'metric';
  id: string;
  op: MetricOp;
  /** Undefined for `count` (Count of records). */
  field?: string;
  /** Field name as shown ("SeverityNumber"); undefined for count. */
  fieldLabel?: string;
  /** Whether the field is numeric — chooses a direct aggregate vs a cast in SQL. */
  numeric?: boolean;
}

export type BucketDim = DateHistogramDim | TermsDim;

export interface LensState {
  chartType: ChartType;
  subType?: XySubType;
  buckets: BucketDim[];
  metrics: MetricDim[];
}

/** A field as the suggestion engine sees it. `records` is the virtual "Records" field (count). */
export interface LensField {
  id: string;
  sqlExpr: string;
  label: string;
  type: FieldType | 'records';
}

export const EMPTY_LENS: LensState = { chartType: 'bar', buckets: [], metrics: [] };

export const RECORDS_FIELD: LensField = { id: '__records__', sqlExpr: '', label: 'Records', type: 'records' };

const OP_NAMES: Record<MetricOp, string> = {
  count: 'Count',
  median: 'Median',
  avg: 'Average',
  sum: 'Sum',
  min: 'Minimum',
  max: 'Maximum',
  unique: 'Unique count',
};

/** Default dimension label, as Kibana words it ("Count of records", "Median of x", "Top 9 values of y"). */
export function dimLabel(d: BucketDim | MetricDim): string {
  if (d.kind === 'metric') {
    return d.op === 'count' ? 'Count of records' : `${OP_NAMES[d.op]} of ${d.fieldLabel ?? d.field}`;
  }
  if (d.kind === 'terms') {
    return `Top ${d.size} values of ${d.label}`;
  }
  return d.label;
}

export const CHART_LABELS: Record<ChartType, string> = {
  line: 'Line',
  area: 'Area',
  bar: 'Bar',
  metric: 'Metric',
  table: 'Table',
  pie: 'Pie',
};

export function isEmptyLens(s: LensState): boolean {
  return s.buckets.length === 0 && s.metrics.length === 0;
}

/** URL form (param `lens`): the state as JSON. Invalid input → undefined. */
export function encodeLens(s: LensState): string {
  return JSON.stringify(s);
}

const CHARTS: readonly ChartType[] = ['line', 'area', 'bar', 'metric', 'table', 'pie'];
const OPS: readonly MetricOp[] = ['count', 'median', 'avg', 'sum', 'min', 'max', 'unique'];

export function decodeLens(raw: string | null | undefined): LensState | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const v = JSON.parse(raw);
    if (!v || !CHARTS.includes(v.chartType) || !Array.isArray(v.buckets) || !Array.isArray(v.metrics)) {
      return undefined;
    }
    const str = (x: unknown) => typeof x === 'string';
    const buckets = (v.buckets as BucketDim[]).filter(
      (b) =>
        b &&
        str(b.id) &&
        str(b.field) &&
        str(b.label) &&
        ((b.kind === 'date_histogram' && b.interval === 'auto') || (b.kind === 'terms' && Number.isInteger(b.size) && b.size > 0))
    );
    const metrics = (v.metrics as MetricDim[]).filter(
      (m) => m && m.kind === 'metric' && str(m.id) && OPS.includes(m.op) && (m.op === 'count' || str(m.field))
    );
    const subType = ['stacked', 'percentage', 'unstacked'].includes(v.subType) ? (v.subType as XySubType) : undefined;
    return { chartType: v.chartType, subType, buckets, metrics };
  } catch {
    return undefined;
  }
}

/**
 * Keeps only dimensions whose field is one of `allowed` (the discovered fields' SQL expressions
 * plus the time column). The `lens` URL param is untrusted — a shared link must never carry its
 * own SQL — so this runs before anything is compiled.
 */
export function sanitizeLens(s: LensState, allowed: ReadonlySet<string>): LensState {
  const buckets = s.buckets.filter((b) => allowed.has(b.field));
  const metrics = s.metrics.filter((m) => m.op === 'count' || (m.field !== undefined && allowed.has(m.field)));
  if (buckets.length === s.buckets.length && metrics.length === s.metrics.length) {
    return s;
  }
  if (buckets.length === 0 && metrics.length === 0) {
    return EMPTY_LENS;
  }
  // Nothing left to put on an axis: show the remaining metrics as numbers.
  if (buckets.length === 0 && s.chartType !== 'metric' && s.chartType !== 'table') {
    return { chartType: 'metric', buckets, metrics };
  }
  return { ...s, buckets, metrics };
}
