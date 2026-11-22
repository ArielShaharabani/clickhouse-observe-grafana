/**
 * Lens state (spec LENS-AUTO-01 / LENS-TYPE-01, docs/spec/20-lens.md; blueprint "LensState").
 *
 * One data layer, kept as two ordered lists instead of per-chart roles: `buckets` (group-by
 * dimensions) and `metrics` (aggregations). Each chart type reads its roles from those lists in
 * order — XY: X = buckets[0], Breakdown = buckets[1]; Table: Rows = buckets; Metric: Break down
 * by = buckets[0]; Pie: slices = buckets — so a chart-type switch is a re-cap of the same lists
 * (LENS-TYPE-01 remapping rules 1–2), never a rebuild.
 */
import { FieldModel, FieldType } from '../sql/fieldModel';
import { formulaErrors, FormulaFields, formulaUsesWindow, formulaTimeSeriesFns, MAX_FORMULA_LEN } from './formula';
import {
  BASE_OPS,
  BaseOp,
  clampWindow,
  cleanRankValue,
  CUMULATIVE_BASE_OPS,
  DEFAULT_WINDOW,
  isCalcOp,
  MetricRef,
} from './calc';
export { cleanRankValue, DEFAULT_RANK_VALUE, MAX_RANK_VALUE } from './calc';
import { cleanStyle, LensStyle } from './style';
import { cleanLayers, ExtraLayer, sanitizeLayers } from './layers';
import { isIntervalValue } from './interval';
import { cleanMetricOptions, MetricOptions, optionsLabelSuffix } from './metricOptions';

export type ChartType = 'line' | 'area' | 'bar' | 'metric' | 'table' | 'pie' | 'donut' | 'heatmap' | 'gauge';
export type XySubType = 'stacked' | 'percentage' | 'unstacked';

export type MetricOp =
  | 'count'
  | 'median'
  | 'avg'
  | 'sum'
  | 'min'
  | 'max'
  | 'unique'
  | 'percentile'
  | 'percentile_rank'
  | 'std_dev'
  | 'last_value'
  | 'cumulative_sum'
  | 'differences'
  | 'moving_average'
  | 'counter_rate'
  | 'formula';

export interface DateHistogramDim {
  kind: 'date_histogram';
  id: string;
  /** SQL expression of the time column. */
  field: string;
  label: string;
  /**
   * 'auto' ≈ 60 buckets over the time range (same rule as the Discover histogram), or a typed
   * minimum interval `<n><unit>` (LENS-DIM-05, parsed by `interval.ts`; scaled up past the cap).
   */
  interval: string;
  /** Include empty rows (default on): gap-fill buckets without documents. Stored only when off. */
  emptyRows?: false;
  /** Drop the first / last bucket when the time range only partly covers it. */
  dropPartial?: true;
  /**
   * Bind to global time picker turned off (only offered for a field other than the view's time
   * field): empty rows are filled over the data's own span instead of the whole picker range.
   */
  unbound?: true;
  /** User-edited name; undefined = automatic label (LENS-DIM-02). */
  name?: string;
}

/** Keeps only the known, well-typed date histogram options of untrusted input. */
export function cleanDateHistogram(b: DateHistogramDim): DateHistogramDim {
  const raw = b as unknown as Record<string, unknown>;
  const out: DateHistogramDim = {
    kind: 'date_histogram',
    id: b.id,
    field: b.field,
    label: b.label,
    interval: isIntervalValue(raw.interval) ? (raw.interval as string).trim() : 'auto',
  };
  if (typeof raw.name === 'string') {
    out.name = raw.name;
  }
  if (raw.emptyRows === false) {
    out.emptyRows = false;
  }
  if (raw.dropPartial === true) {
    out.dropPartial = true;
  }
  if (raw.unbound === true) {
    out.unbound = true;
  }
  return out;
}

export interface TermsDim {
  kind: 'terms';
  id: string;
  field: string;
  label: string;
  /** Top N by count (LENS-AUTO-01 rule 2: 9). */
  size: number;
  /** Rank by (LENS-DIM-04): record count (default), alphabetical, or a custom metric (`rankMetric`). */
  rankBy?: TermsRankBy;
  /** Id of the metric ranked by when `rankBy` is 'metric'; a missing metric falls back to count. */
  rankMetric?: string;
  /** Rank direction; default descending, except alphabetical (ascending). */
  rankDir?: 'asc' | 'desc';
  /** Group the values outside the top N into one "Other" value. */
  other?: boolean;
  /** Include documents without the field, as the value "(missing)". */
  missing?: boolean;
  /** Include / exclude values: exact values, or regular expressions (full match) when `regex`. */
  include?: string[];
  exclude?: string[];
  regex?: boolean;
  name?: string;
}

export type TermsRankBy = 'count' | 'alpha' | 'metric';
export const RANK_BYS: readonly TermsRankBy[] = ['count', 'alpha', 'metric'];
/** Labels of the synthetic values (also what a chart click must not turn into a filter). */
export const OTHER_VALUE = 'Other';
export const MISSING_VALUE = '(missing)';
export const MAX_PATTERNS = 50;
export const MAX_PATTERN_LEN = 200;

/**
 * Row kind of a top-values bucket that has "Other" / "(missing)" on: the query returns it in a
 * separate column next to the value, so a real value spelled "Other" is never confused with the
 * synthetic bucket.
 */
export const KIND_VALUE = 0;
export const KIND_OTHER = 1;
export const KIND_MISSING = 2;

/** Whether a top-values bucket returns a row-kind column (Other and / or missing is on). */
export const hasKindColumn = (b: TermsDim): boolean => !!(b.other || b.missing);

/**
 * Why a regular expression cannot be used, or null. The query wraps it as `^(?:p)$` (RE2), so
 * anything that could break out of the wrapper (unbalanced parentheses, a trailing backslash) or
 * that RE2 does not support (lookaround, back-references) is rejected up front.
 */
export function regexError(p: string): string | null {
  if (p.length > MAX_PATTERN_LEN) {
    return `Pattern too long (max ${MAX_PATTERN_LEN} characters)`;
  }
  let depth = 0;
  let inClass = false;
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '\\') {
      const n = p[i + 1];
      if (n === undefined) {
        return 'Pattern ends with a backslash';
      }
      if (/[1-9k]/.test(n)) {
        return 'Back-references are not supported';
      }
      i++;
    } else if (inClass) {
      // A POSIX item ([:alpha:]) is one unit inside a class; `]` ends the class otherwise.
      const posix = /^\[:\^?[a-z]+:\]/.exec(p.slice(i));
      if (posix) {
        i += posix[0].length - 1;
      } else {
        inClass = c !== ']';
      }
    } else if (c === '[') {
      inClass = true;
      // As in RE2, a `]` right after `[` or `[^` is a literal, not the end of the class.
      if (p[i + 1] === '^') {
        i++;
      }
      if (p[i + 1] === ']') {
        i++;
      }
    } else if (c === '(') {
      depth++;
    } else if (c === ')' && --depth < 0) {
      return 'Unbalanced parentheses';
    }
  }
  if (depth !== 0 || inClass) {
    return 'Unbalanced parentheses or brackets';
  }
  if (/\(\?<?[=!]/.test(p)) {
    return 'Lookaround is not supported';
  }
  try {
    new RegExp(p);
  } catch {
    return 'Invalid regular expression';
  }
  return null;
}

/** Message for an include / exclude list that cannot be applied as typed, or null. */
export function listError(list: string[], regex: boolean): string | null {
  if (list.length > MAX_PATTERNS) {
    return `Max ${MAX_PATTERNS} values`;
  }
  if (list.some((v) => v.length > MAX_PATTERN_LEN)) {
    return `Max ${MAX_PATTERN_LEN} characters per value`;
  }
  if (regex) {
    for (const p of list) {
      const e = regexError(p);
      if (e) {
        return `${e}: ${p.slice(0, 40)}`;
      }
    }
  }
  return null;
}

/**
 * Resets a rank-by-metric that points at a metric the state no longer has, or one that cannot be
 * ranked by (a calculation other than Cumulative sum): back to count.
 */
export function dropMissingRankMetric(s: LensState): LensState {
  const ok = new Set(s.metrics.filter(isRankable).map((m) => m.id));
  let changed = false;
  const buckets = s.buckets.map((b) => {
    if (b.kind === 'terms' && b.rankBy === 'metric' && !(b.rankMetric && ok.has(b.rankMetric))) {
      changed = true;
      return { ...b, rankBy: undefined, rankMetric: undefined, rankDir: undefined };
    }
    return b;
  });
  return changed ? { ...s, buckets } : s;
}

/** Effective direction: explicit, else descending (alphabetical: ascending). */
export function rankDirOf(b: TermsDim): 'asc' | 'desc' {
  return b.rankDir ?? (b.rankBy === 'alpha' ? 'asc' : 'desc');
}

const cleanList = (x: unknown): string[] | undefined => {
  if (!Array.isArray(x)) {
    return undefined;
  }
  const out = x.filter((v): v is string => typeof v === 'string' && v.length > 0 && v.length <= MAX_PATTERN_LEN);
  return out.length > 0 ? out.slice(0, MAX_PATTERNS) : undefined;
};

/** Keeps only the known, well-typed top-values options of untrusted input (nothing else rides along). */
export function cleanTerms(b: TermsDim): TermsDim {
  const raw = b as unknown as Record<string, unknown>;
  const out: TermsDim = { kind: 'terms', id: b.id, field: b.field, label: b.label, size: b.size };
  if (typeof raw.name === 'string') {
    out.name = raw.name;
  }
  if (RANK_BYS.includes(raw.rankBy as TermsRankBy) && raw.rankBy !== 'count') {
    out.rankBy = raw.rankBy as TermsRankBy;
  }
  if (typeof raw.rankMetric === 'string' && raw.rankMetric.length <= MAX_NAME) {
    out.rankMetric = raw.rankMetric;
  }
  if (raw.rankDir === 'asc' || raw.rankDir === 'desc') {
    out.rankDir = raw.rankDir;
  }
  for (const k of ['other', 'missing', 'regex'] as const) {
    if (raw[k] === true) {
      out[k] = true;
    }
  }
  const inc = cleanList(raw.include);
  const exc = cleanList(raw.exclude);
  if (inc) {
    out.include = inc;
  }
  if (exc) {
    out.exclude = exc;
  }
  return out;
}

/** A metric; `MetricOptions` holds its Advanced / Appearance options (LENS-DIM-02, PLAN 16g). */
export interface MetricDim extends MetricOptions {
  kind: 'metric';
  id: string;
  op: MetricOp;
  /** Undefined for `count` (Count of records). */
  field?: string;
  /** Field name as shown ("SeverityNumber"); undefined for count. */
  fieldLabel?: string;
  /** Whether the field is numeric — chooses a direct aggregate vs a cast in SQL. */
  numeric?: boolean;
  /** For `percentile`: 1–99 (default 95). */
  percentile?: number;
  /** For `percentile_rank`: the value whose rank is computed (default 0, as Kibana). */
  rankValue?: number;
  /**
   * For Cumulative sum / Differences / Moving average (LENS-CALC-01): the metric calculated on
   * (Counter rate keeps its field on the metric itself: it is always computed on the maximum).
   */
  ref?: MetricRef;
  /** For Moving average: how many previous buckets are averaged (1–100, default 5). */
  window?: number;
  /** For `formula` (LENS-DIM-03): the formula text, parsed and compiled by `formula.ts`. */
  formula?: string;
  /** For `formula`: the fields it may use (name as written → field SQL expression + numeric). */
  formulaFields?: FormulaFields;
  name?: string;
  /** Metric chart (LENS-CHART-01): this metric is the tiles' Maximum value (progress bar), not a tile value. */
  role?: 'max';
  /** Table (LENS-CHART-01): summary row function of this metric's column(s). */
  summary?: TableSummary;
  /** Table (LENS-CHART-01): colour the cell background or text by value. */
  colorBy?: 'cell' | 'text';
}

/** Summary row functions of a Table metric column (Kibana's "Summary row"). */
export type TableSummary = 'sum' | 'avg' | 'count' | 'min' | 'max';
export const TABLE_SUMMARIES: readonly TableSummary[] = ['sum', 'avg', 'count', 'min', 'max'];

/**
 * A bucket dimension. `pivot` (Table only, LENS-CHART-01): the bucket is in "Split metrics by" —
 * its values become metric columns instead of rows.
 */
export type BucketDim = (DateHistogramDim | TermsDim | RangeDim | FiltersDim) & { pivot?: true };

/** One custom range of an Intervals bucket: `from <= x < to`, either end open. */
export interface RangeSpec {
  from?: number;
  to?: number;
  label?: string;
}

/**
 * Intervals (LENS-DIM-05, number fields): automatic buckets of a "nice" width (a power of ten
 * sized from the data's min / max and the granularity), or custom ranges.
 */
export interface RangeDim {
  kind: 'range';
  id: string;
  field: string;
  label: string;
  /** Whether the field is numeric — chooses a direct value vs a cast in SQL. */
  numeric?: boolean;
  /** Custom ranges; absent = automatic granularity. */
  ranges?: RangeSpec[];
  /** 1 (coarse) … 7 (fine); default 4. */
  granularity?: number;
  /** Include empty rows (automatic buckets; default on). Stored only when off. */
  emptyRows?: false;
  name?: string;
}

/** One Filters bucket: a KQL query (through the search bar's compiler) and an optional label. */
export interface FilterSpec {
  query: string;
  label?: string;
}

/** Filters (LENS-DIM-05): one bucket per KQL query; a document can fall in several. */
export interface FiltersDim {
  kind: 'filters';
  id: string;
  /** No field: '' (the queries name their own fields). */
  field: '';
  label: string;
  filters: FilterSpec[];
  name?: string;
}

export const MAX_RANGES = 20;
export const MAX_FILTERS = 20;
export const MAX_FILTER_QUERY = 1000;
export const DEFAULT_GRANULARITY = 4;
/** Target bucket count per granularity step (1 … 7). */
export const GRANULARITY_TARGETS = [5, 10, 20, 50, 100, 200, 500];
export const ALL_RECORDS = 'All records';

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const shortText = (x: unknown): string | undefined =>
  typeof x === 'string' && x.trim() && x.length <= MAX_NAME ? x : undefined;

/** Keeps only the known, well-typed Intervals options of untrusted input. */
export function cleanRange(b: RangeDim): RangeDim {
  const raw = b as unknown as Record<string, unknown>;
  const out: RangeDim = { kind: 'range', id: b.id, field: b.field, label: b.label };
  if (raw.numeric === true) {
    out.numeric = true;
  }
  if (typeof raw.name === 'string') {
    out.name = raw.name;
  }
  if (Number.isInteger(raw.granularity) && (raw.granularity as number) >= 1 && (raw.granularity as number) <= 7) {
    if (raw.granularity !== DEFAULT_GRANULARITY) {
      out.granularity = raw.granularity as number;
    }
  }
  if (raw.emptyRows === false) {
    out.emptyRows = false;
  }
  if (Array.isArray(raw.ranges)) {
    const ranges = (raw.ranges as unknown[])
      .filter((r): r is Record<string, unknown> => !!r && typeof r === 'object')
      .slice(0, MAX_RANGES)
      .map((r) => {
        const spec: RangeSpec = {};
        if (finite(r.from)) {
          spec.from = r.from;
        }
        if (finite(r.to)) {
          spec.to = r.to;
        }
        const label = shortText(r.label);
        if (label) {
          spec.label = label;
        }
        return spec;
      });
    out.ranges = ranges;
  }
  return out;
}

/** Keeps only well-formed filters of untrusted input (text only; compiled by the KQL compiler). */
export function cleanFilters(b: FiltersDim): FiltersDim {
  const raw = b as unknown as Record<string, unknown>;
  const list = Array.isArray(raw.filters) ? (raw.filters as unknown[]) : [];
  const filters = list
    .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
    .filter((f) => typeof f.query === 'string' && (f.query as string).length <= MAX_FILTER_QUERY)
    .slice(0, MAX_FILTERS)
    .map((f) => {
      const spec: FilterSpec = { query: f.query as string };
      const label = shortText(f.label);
      if (label) {
        spec.label = label;
      }
      return spec;
    });
  const out: FiltersDim = { kind: 'filters', id: b.id, field: '', label: 'Filters', filters };
  if (typeof raw.name === 'string') {
    out.name = raw.name;
  }
  return out;
}

/** Display label of a custom range ("0 – 100", "≥ 500", "< 10") unless it has its own. */
export function rangeLabel(r: RangeSpec): string {
  if (r.label) {
    return r.label;
  }
  if (r.from !== undefined && r.to !== undefined) {
    return `${r.from} – ${r.to}`;
  }
  if (r.from !== undefined) {
    return `≥ ${r.from}`;
  }
  return r.to !== undefined ? `< ${r.to}` : 'All values';
}

/** Display label of a Filters bucket: its label, else the query, else "All records". */
export function filterLabel(f: FilterSpec): string {
  return f.label ?? (f.query.trim() || ALL_RECORDS);
}

export interface LensState {
  chartType: ChartType;
  subType?: XySubType;
  /** XY Style / Legend settings (LENS-STYLE-01); display-only. */
  style?: LensStyle;
  /** XY reference line / annotation layers (LENS-LAYER-01); not part of the chart query. */
  layers?: ExtraLayer[];
  buckets: BucketDim[];
  metrics: MetricDim[];
  /**
   * What the current chart can't show, kept from the chart the user switched away from (Kibana keeps
   * a layer's unused columns): a date histogram dropped by Metric / Pie, an XY chart's Style and
   * layers. Switching back restores it. Not part of the chart query.
   */
  parked?: LensParked;
  /** Gauge options (R3-CHARTS); display-only, kept across chart switches, drawn only on a gauge. */
  gauge?: GaugeOptions;
}

/**
 * Gauge (R3-CHARTS): the shape (arc = Grafana `gauge`, bar = `bargauge`), the range and optional
 * colour bands. Max: the "Maximum value" metric when there is one, else `max`, else automatic (a
 * round number above the largest value).
 */
export interface GaugeOptions {
  shape?: 'bar';
  min?: number;
  max?: number;
  /** Green / amber / red bands at 70 % and 90 % of the range ('low': low values are good). */
  bands?: 'low' | 'high';
}

/** Keeps only the known, well-typed gauge options of untrusted input; nothing set → undefined. */
export function cleanGauge(raw: unknown): GaugeOptions | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return undefined;
  }
  const g = raw as Record<string, unknown>;
  const out: GaugeOptions = {};
  if (g.shape === 'bar') {
    out.shape = 'bar';
  }
  const okNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e15;
  if (okNum(g.min) && g.min !== 0) {
    out.min = g.min;
  }
  if (okNum(g.max)) {
    out.max = g.max;
  }
  if (out.min !== undefined && out.max !== undefined && out.max <= out.min) {
    delete out.max;
  }
  if (g.bands === 'low' || g.bands === 'high') {
    out.bands = g.bands;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** At most this many gauges (one per Break down by value) are drawn. */
export const MAX_GAUGES = 12;

export interface LensParked {
  /** The last chart that could show the parked buckets (where a dropped time field returns to). */
  chartType: ChartType;
  subType?: XySubType;
  buckets: BucketDim[];
  /** Metrics the current chart can't show (Pie / Heat map / Gauge show one), restored by a switch back. */
  metrics?: MetricDim[];
  style?: LensStyle;
  layers?: ExtraLayer[];
}

/** At most this many parked buckets (and parked metrics) survive the URL. */
export const MAX_PARKED = 8;

/** A field as the suggestion engine sees it. `records` is the virtual "Records" field (count). */
export interface LensField {
  id: string;
  sqlExpr: string;
  label: string;
  type: FieldType | 'records';
  /** Display only (R5-JSON #7): where the field comes from and its ClickHouse type, for the field list's badge and tooltip. */
  source?: FieldModel['source'];
  rawType?: string;
  mapColumn?: string;
  jsonColumn?: string;
}

let idSeq = 0;
/** Unique-enough dimension id for this page (URL-carried ids are only compared, never trusted). */
export function newDimId(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${(idSeq++).toString(36)}`;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th", 23 → "23rd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix =
    tens >= 11 && tens <= 13 ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th');
  return `${n}${suffix}`;
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
  percentile: 'Percentile',
  percentile_rank: 'Percentile rank',
  std_dev: 'Standard deviation',
  last_value: 'Last value',
  cumulative_sum: 'Cumulative sum',
  differences: 'Differences',
  moving_average: 'Moving average',
  counter_rate: 'Counter rate',
  formula: 'Formula',
};

/** Display name of a quick function (LENS-DIM-02 grid). */
export function opName(op: MetricOp): string {
  return OP_NAMES[op];
}

export const DEFAULT_PERCENTILE = 95;
/** Percentile clamped to 1–99; anything else → the default. */
export function clampPercentile(p: unknown): number {
  const n = Number(p);
  return Number.isFinite(n) ? Math.min(99, Math.max(1, Math.round(n))) : DEFAULT_PERCENTILE;
}

/** Longest custom name kept (display only). */
export const MAX_NAME = 120;

/**
 * Default dimension label, as Kibana words it ("Count of records", "Median of x", "Top 9 values of
 * y"). `metrics` names the rank metric of a top-values dimension ranked by a custom metric.
 */
export function dimLabelIn(d: BucketDim | MetricDim, metrics?: MetricDim[]): string {
  return d.name?.trim() ? d.name : autoLabelIn(d, metrics);
}

export const dimLabel = (d: BucketDim | MetricDim): string => dimLabelIn(d);
export const autoLabel = (d: BucketDim | MetricDim): string => autoLabelIn(d);

/** The automatic label, ignoring any user-edited name. */
export function autoLabelIn(d: BucketDim | MetricDim, metrics?: MetricDim[]): string {
  if (d.kind === 'metric') {
    // Counter rate is always per unit of time (per second unless normalized otherwise).
    return (
      metricBaseLabel(d) + optionsLabelSuffix(d.op === 'counter_rate' ? { ...d, normalize: d.normalize ?? 's' } : d)
    );
  }
  if (d.kind === 'terms') {
    const dir = rankDirOf(d);
    if (d.rankBy === 'alpha') {
      return `${dir === 'asc' ? 'First' : 'Last'} ${d.size} values of ${d.label}`;
    }
    const lead = `${dir === 'asc' ? 'Bottom' : 'Top'} ${d.size} values of ${d.label}`;
    const rm = d.rankBy === 'metric' ? metrics?.find((m) => m.id === d.rankMetric && isRankable(m)) : undefined;
    return rm ? `${lead} by ${autoLabelIn(rm)}` : lead;
  }
  if (d.kind === 'filters') {
    return d.filters.length === 1 ? filterLabel(d.filters[0]) : 'Filters';
  }
  if (d.kind === 'range') {
    return d.ranges ? `${d.label} ranges` : d.label;
  }
  return d.label;
}

function metricBaseLabel(d: MetricDim): string {
  if (d.op === 'count') {
    return 'Count of records';
  }
  if (d.op === 'formula') {
    const f = (d.formula ?? '').trim();
    return f.length > 60 ? `${f.slice(0, 57)}…` : f || 'Formula';
  }
  if (d.op === 'cumulative_sum' || d.op === 'differences' || d.op === 'moving_average') {
    return `${OP_NAMES[d.op]} of ${d.ref ? refLabel(d.ref) : 'Count of records'}`;
  }
  const what = d.fieldLabel ?? d.field;
  return d.op === 'percentile'
    ? `${ordinal(clampPercentile(d.percentile))} percentile of ${what}`
    : d.op === 'percentile_rank'
      ? `Percentile rank (${cleanRankValue(d.rankValue)}) of ${what}`
      : `${OP_NAMES[d.op]} of ${what}`;
}

/** Label of a calculation's inner metric ("Count of records", "Median of duration"). */
export function refLabel(r: MetricRef): string {
  if (r.op === 'count') {
    return 'Count of records';
  }
  const what = r.fieldLabel ?? r.field;
  return r.op === 'percentile'
    ? `${ordinal(clampPercentile(r.percentile))} percentile of ${what}`
    : r.op === 'percentile_rank'
      ? `Percentile rank (${cleanRankValue(r.rankValue)}) of ${what}`
      : `${OP_NAMES[r.op]} of ${what}`;
}

/** The inner metric of a calculation as a metric of its own (same id and Filter by / time shift). */
export function refMetric(m: MetricDim): MetricDim {
  const r = m.ref ?? { op: 'count' as const };
  const out: MetricDim = { kind: 'metric', id: m.id, op: r.op, filter: m.filter, shift: m.shift };
  if (r.op !== 'count') {
    out.field = r.field;
    out.fieldLabel = r.fieldLabel;
    out.numeric = r.numeric;
  }
  if (r.op === 'percentile') {
    out.percentile = clampPercentile(r.percentile);
  }
  if (r.op === 'percentile_rank') {
    out.rankValue = cleanRankValue(r.rankValue);
  }
  return out;
}

const FORMULA_CACHE_MAX = 200;
const USES_WINDOW = new Map<string, boolean>();
const NEEDS_HISTOGRAM = new Map<string, boolean>();

/** Per-formula-string memo (small bounded cache): these run in render paths and re-parse otherwise. */
function memoFormula(cache: Map<string, boolean>, src: string, compute: (src: string) => boolean): boolean {
  const hit = cache.get(src);
  if (hit !== undefined) {
    return hit;
  }
  const v = compute(src);
  if (cache.size >= FORMULA_CACHE_MAX) {
    cache.clear();
  }
  cache.set(src, v);
  return v;
}

/** Whether a metric is a time-series calculation (quick function, or a formula using one / overall_*). */
export function usesWindow(m: MetricDim): boolean {
  return isCalcOp(m.op) || (m.op === 'formula' && memoFormula(USES_WINDOW, m.formula ?? '', formulaUsesWindow));
}

/** Whether a metric needs a date histogram (time-series calculations; overall_* does not). */
export function needsDateHistogram(m: MetricDim): boolean {
  return (
    isCalcOp(m.op) ||
    (m.op === 'formula' && memoFormula(NEEDS_HISTOGRAM, m.formula ?? '', (f) => formulaTimeSeriesFns(f).length > 0))
  );
}

/**
 * Why the chart cannot be computed as configured, or null: a time-series calculation without a
 * date histogram (e.g. after a switch to Metric parked it). Shown instead of the chart — never
 * numbers that would be wrong.
 */
export function calculationError(s: Pick<LensState, 'buckets' | 'metrics'>): string | null {
  if (s.buckets.some((b) => b.kind === 'date_histogram')) {
    return null;
  }
  const m = s.metrics.find(needsDateHistogram);
  if (!m) {
    return null;
  }
  const what =
    m.op === 'formula'
      ? `The formula uses ${formulaTimeSeriesFns(m.formula ?? '').join(', ')}, which needs`
      : `${dimLabelIn(m)} needs`;
  return `${what} a date histogram dimension. Add a date histogram, or choose a function that is not a calculation.`;
}

/**
 * Whether top values can be ranked by this metric: any plain metric, and Cumulative sum (ranked by
 * its inner metric — the series total, i.e. its last value). Other calculations have no single value
 * per top value to rank by.
 */
export function isRankable(m: MetricDim): boolean {
  return m.op === 'cumulative_sum' || !usesWindow(m);
}

export const CHART_LABELS: Record<ChartType, string> = {
  line: 'Line',
  area: 'Area',
  bar: 'Bar',
  metric: 'Metric',
  table: 'Table',
  pie: 'Pie',
  donut: 'Donut',
  heatmap: 'Heat map',
  gauge: 'Gauge',
};

export function isEmptyLens(s: LensState): boolean {
  return s.buckets.length === 0 && s.metrics.length === 0;
}

/** URL form (param `lens`): the state as JSON. Invalid input → undefined. */
export function encodeLens(s: LensState): string {
  return JSON.stringify(s);
}

const CHARTS: readonly ChartType[] = ['line', 'area', 'bar', 'metric', 'table', 'pie', 'donut', 'heatmap', 'gauge'];
const OPS: readonly MetricOp[] = [
  'count',
  'median',
  'avg',
  'sum',
  'min',
  'max',
  'unique',
  'percentile',
  'percentile_rank',
  'std_dev',
  'last_value',
  'cumulative_sum',
  'differences',
  'moving_average',
  'counter_rate',
  'formula',
];

/** A calculation's inner metric from untrusted input (known op, string field, clamped percentile). */
export function cleanRef(x: unknown, op: MetricOp): MetricRef | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const r = x as Record<string, unknown>;
  const allowed = op === 'cumulative_sum' ? CUMULATIVE_BASE_OPS : BASE_OPS;
  if (!allowed.includes(r.op as BaseOp)) {
    return undefined;
  }
  const out: MetricRef = { op: r.op as BaseOp };
  if (out.op === 'count') {
    return out;
  }
  if (typeof r.field !== 'string' || r.field.length > 1000) {
    return undefined;
  }
  out.field = r.field;
  if (typeof r.fieldLabel === 'string') {
    out.fieldLabel = r.fieldLabel.slice(0, 500);
  }
  out.numeric = r.numeric === true;
  if (out.op === 'percentile') {
    out.percentile = clampPercentile(r.percentile);
  }
  if (out.op === 'percentile_rank') {
    out.rankValue = cleanRankValue(r.rankValue);
  }
  return out;
}

/** Calculations that wrap another metric (Counter rate keeps a field of its own). */
export const hasRef = (op: MetricOp): boolean =>
  op === 'cumulative_sum' || op === 'differences' || op === 'moving_average';

/** Table / Metric chart options of a metric (LENS-CHART-01), from untrusted input. */
function cleanChartOptions(m: MetricDim): Pick<MetricDim, 'role' | 'summary' | 'colorBy'> {
  const out: Pick<MetricDim, 'role' | 'summary' | 'colorBy'> = {};
  if (m.role === 'max') {
    out.role = 'max';
  }
  if (TABLE_SUMMARIES.includes(m.summary as TableSummary)) {
    out.summary = m.summary;
  }
  if (m.colorBy === 'cell' || m.colorBy === 'text') {
    out.colorBy = m.colorBy;
  }
  return out;
}

/** Keeps only a well-formed `{ name: { expr, numeric } }` map of untrusted input. */
function cleanFormulaFields(x: unknown): FormulaFields | undefined {
  if (!x || typeof x !== 'object' || Array.isArray(x)) {
    return undefined;
  }
  const out: FormulaFields = {};
  for (const [k, v] of Object.entries(x as Record<string, unknown>).slice(0, 50)) {
    const r = v as { expr?: unknown; numeric?: unknown } | null;
    if (k.length <= 500 && r && typeof r.expr === 'string' && r.expr.length <= 1000) {
      out[k] = { expr: r.expr, numeric: r.numeric === true };
    }
  }
  return out;
}

const isStr = (x: unknown) => typeof x === 'string';
const okDimName = (n: unknown) => n === undefined || (isStr(n) && (n as string).length <= MAX_NAME);

/** Known bucket kinds with well-typed keys only (the URL is untrusted). */
function cleanBuckets(raw: unknown): BucketDim[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return (raw as BucketDim[])
    .filter(
      (b) =>
        b &&
        isStr(b.id) &&
        isStr(b.field) &&
        isStr(b.label) &&
        okDimName(b.name) &&
        ((b.kind === 'date_histogram' && isIntervalValue(b.interval)) ||
          (b.kind === 'terms' && Number.isInteger(b.size) && b.size > 0) ||
          b.kind === 'range' ||
          (b.kind === 'filters' && b.field === '' && Array.isArray(b.filters)))
    )
    .map((b): BucketDim => {
      const out: BucketDim =
        b.kind === 'terms'
          ? cleanTerms(b)
          : b.kind === 'range'
            ? cleanRange(b)
            : b.kind === 'filters'
              ? cleanFilters(b)
              : cleanDateHistogram(b);
      return b.pivot === true ? { ...out, pivot: true } : out;
    });
}

/** Known metric functions with well-typed keys only (the URL is untrusted). */
function cleanMetrics(raw: unknown): MetricDim[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const str = (x: unknown) => typeof x === 'string';
  const okName = (n: unknown) => n === undefined || (str(n) && (n as string).length <= MAX_NAME);
  const okPct = (p: unknown) => p === undefined || (typeof p === 'number' && Number.isFinite(p) && p >= 1 && p <= 99);
  return (raw as MetricDim[])
    .map((m) => ({ m, ref: m && OPS.includes(m.op) && hasRef(m.op) ? cleanRef(m.ref, m.op) : undefined }))
    .filter(
      ({ m, ref }) =>
        m &&
        m.kind === 'metric' &&
        str(m.id) &&
        OPS.includes(m.op) &&
        (m.op === 'formula'
          ? str(m.formula) && (m.formula as string).length <= MAX_FORMULA_LEN
          : hasRef(m.op)
            ? ref !== undefined
            : m.op === 'count' || str(m.field)) &&
        okName(m.name) &&
        okPct(m.percentile)
    )
    .map(({ m, ref }): MetricDim => {
      // Only known, well-typed keys survive (the URL is untrusted).
      const opts = { ...cleanMetricOptions(m as unknown as Record<string, unknown>), ...cleanChartOptions(m) };
      if (m.op === 'formula') {
        return {
          kind: 'metric',
          id: m.id,
          op: 'formula',
          formula: m.formula,
          formulaFields: cleanFormulaFields(m.formulaFields) ?? {},
          name: m.name,
          ...opts,
        };
      }
      const out: MetricDim = { kind: 'metric', id: m.id, op: m.op, name: m.name, ...opts };
      if (hasRef(m.op)) {
        out.ref = ref;
        if (m.op === 'moving_average') {
          out.window = m.window === undefined ? DEFAULT_WINDOW : clampWindow(m.window);
        }
        return out;
      }
      if (m.op !== 'count') {
        out.field = m.field;
        out.fieldLabel = typeof m.fieldLabel === 'string' ? m.fieldLabel.slice(0, 500) : undefined;
        out.numeric = m.numeric === true;
      }
      if (m.op === 'percentile') {
        out.percentile = m.percentile;
      }
      if (m.op === 'percentile_rank') {
        out.rankValue = cleanRankValue(m.rankValue);
      }
      return out;
    });
}

function cleanParked(raw: unknown): LensParked | undefined {
  if (!raw || typeof raw !== 'object') {
    return undefined;
  }
  const p = raw as Record<string, unknown>;
  if (!CHARTS.includes(p.chartType as ChartType)) {
    return undefined;
  }
  const buckets = cleanBuckets(p.buckets).slice(0, MAX_PARKED);
  const metrics = cleanMetrics(p.metrics).slice(0, MAX_PARKED);
  const style = cleanStyle(p.style);
  const layers = cleanLayers(p.layers);
  if (buckets.length === 0 && metrics.length === 0 && !style && !layers) {
    return undefined;
  }
  const subType = ['stacked', 'percentage', 'unstacked'].includes(p.subType as string)
    ? (p.subType as XySubType)
    : undefined;
  return {
    chartType: p.chartType as ChartType,
    ...(subType ? { subType } : {}),
    buckets,
    ...(metrics.length > 0 ? { metrics } : {}),
    ...(style ? { style } : {}),
    ...(layers ? { layers } : {}),
  };
}

export function decodeLens(raw: string | null | undefined): LensState | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const v = JSON.parse(raw);
    if (!v || !CHARTS.includes(v.chartType) || !Array.isArray(v.buckets) || !Array.isArray(v.metrics)) {
      return undefined;
    }
    const buckets = cleanBuckets(v.buckets);
    const metrics = cleanMetrics(v.metrics);
    const subType = ['stacked', 'percentage', 'unstacked'].includes(v.subType) ? (v.subType as XySubType) : undefined;
    const style = cleanStyle(v.style);
    const layers = cleanLayers(v.layers);
    const parked = cleanParked(v.parked);
    const gauge = cleanGauge(v.gauge);
    return dropMissingRankMetric({
      chartType: v.chartType,
      subType,
      buckets,
      metrics,
      ...(style ? { style } : {}),
      ...(layers ? { layers } : {}),
      ...(parked ? { parked } : {}),
      ...(gauge ? { gauge } : {}),
    });
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
  // Filters buckets have no field: their queries go through the KQL compiler like the search bar.
  const kept = s.buckets.filter((b) => b.kind === 'filters' || allowed.has(b.field));
  const metrics = s.metrics.filter((m) => metricAllowed(m, allowed));
  // A rank metric that no longer exists falls back to ranking by count.
  const ids = new Set(metrics.filter(isRankable).map((m) => m.id));
  // Computed reference lines (LENS-LAYER-01) follow the same field rule.
  const layers = sanitizeLayers(s.layers, allowed);
  const parked = sanitizeParked(s.parked, allowed);
  const buckets = kept.map((b) =>
    b.kind === 'terms' && b.rankBy === 'metric' && !(b.rankMetric && ids.has(b.rankMetric))
      ? { ...b, rankBy: undefined, rankMetric: undefined }
      : b
  );
  if (
    kept.length === s.buckets.length &&
    metrics.length === s.metrics.length &&
    buckets.every((b, i) => b === kept[i]) &&
    layers === s.layers &&
    parked === s.parked
  ) {
    return s;
  }
  if (buckets.length === 0 && metrics.length === 0) {
    return EMPTY_LENS;
  }
  // Nothing left to put on an axis: show the remaining metrics as numbers.
  if (buckets.length === 0 && s.chartType !== 'metric' && s.chartType !== 'table' && s.chartType !== 'gauge') {
    return { chartType: 'metric', buckets, metrics };
  }
  const { layers: _l, parked: _p, ...rest } = s;
  return { ...rest, buckets, metrics, ...(layers ? { layers } : {}), ...(parked ? { parked } : {}) };
}

/**
 * Whether the chart must still wait for field discovery (round 3 #8): until this view's columns are
 * published, and — while the rest (JSON paths) is still loading — only if the chart uses a field
 * not known yet, so a real field is never dropped for being "unknown" and a chart on plain columns
 * does not wait for the slower discovery steps.
 */
export function lensFieldsPending(
  fieldsPublished: boolean,
  discovering: boolean,
  s: LensState,
  allowed: ReadonlySet<string>
): boolean {
  return !fieldsPublished || (discovering && sanitizeLens(s, allowed) !== s);
}

/** Parked buckets / layers follow the same field rule as the visible ones. */
function sanitizeParked(p: LensParked | undefined, allowed: ReadonlySet<string>): LensParked | undefined {
  if (!p) {
    return p;
  }
  const buckets = p.buckets.filter((b) => b.kind === 'filters' || allowed.has(b.field));
  const metrics = p.metrics?.filter((m) => metricAllowed(m, allowed));
  const layers = sanitizeLayers(p.layers, allowed);
  if (buckets.length === p.buckets.length && metrics?.length === p.metrics?.length && layers === p.layers) {
    return p;
  }
  const { layers: _l, metrics: _m, ...rest } = p;
  const out: LensParked = {
    ...rest,
    buckets,
    ...(metrics && metrics.length > 0 ? { metrics } : {}),
    ...(layers ? { layers } : {}),
  };
  return out.buckets.length === 0 && !out.metrics && !out.style && !out.layers ? undefined : out;
}

/** A metric's field (or a formula's fields) must be a discovered field; count needs none. */
function metricAllowed(m: MetricDim, allowed: ReadonlySet<string>): boolean {
  return m.op === 'formula'
    ? formulaAllowed(m, allowed)
    : hasRef(m.op)
      ? !!m.ref && (m.ref.op === 'count' || (m.ref.field !== undefined && allowed.has(m.ref.field)))
      : m.op === 'count' || (m.field !== undefined && allowed.has(m.field));
}

/**
 * A formula metric survives sanitizing only when it parses, validates against its own field map,
 * and every field it refers to is a discovered field (same rule as a quick function's `field`).
 */
function formulaAllowed(m: MetricDim, allowed: ReadonlySet<string>): boolean {
  const fields = m.formulaFields ?? {};
  if (!m.formula || formulaErrors(m.formula, fields).length > 0) {
    return false;
  }
  return Object.values(fields).every((f) => allowed.has(f.expr));
}
