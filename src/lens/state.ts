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
import { formulaErrors, FormulaFields, MAX_FORMULA_LEN } from './formula';
import { isIntervalValue } from './interval';

export type ChartType = 'line' | 'area' | 'bar' | 'metric' | 'table' | 'pie';
export type XySubType = 'stacked' | 'percentage' | 'unstacked';

export type MetricOp = 'count' | 'median' | 'avg' | 'sum' | 'min' | 'max' | 'unique' | 'percentile' | 'formula';

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

/** Resets a rank-by-metric that points at a metric the state no longer has (back to count). */
export function dropMissingRankMetric(s: LensState): LensState {
  const ids = new Set(s.metrics.map((m) => m.id));
  let changed = false;
  const buckets = s.buckets.map((b) => {
    if (b.kind === 'terms' && b.rankBy === 'metric' && !(b.rankMetric && ids.has(b.rankMetric))) {
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
  /** For `percentile`: 1–99 (default 95). */
  percentile?: number;
  /** For `formula` (LENS-DIM-03): the formula text, parsed and compiled by `formula.ts`. */
  formula?: string;
  /** For `formula`: the fields it may use (name as written → field SQL expression + numeric). */
  formulaFields?: FormulaFields;
  name?: string;
}

export type BucketDim = DateHistogramDim | TermsDim | RangeDim | FiltersDim;

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
    if (d.op === 'count') {
      return 'Count of records';
    }
    if (d.op === 'formula') {
      const f = (d.formula ?? '').trim();
      return f.length > 60 ? `${f.slice(0, 57)}…` : f || 'Formula';
    }
    const what = d.fieldLabel ?? d.field;
    return d.op === 'percentile'
      ? `${ordinal(clampPercentile(d.percentile))} percentile of ${what}`
      : `${OP_NAMES[d.op]} of ${what}`;
  }
  if (d.kind === 'terms') {
    const dir = rankDirOf(d);
    if (d.rankBy === 'alpha') {
      return `${dir === 'asc' ? 'First' : 'Last'} ${d.size} values of ${d.label}`;
    }
    const lead = `${dir === 'asc' ? 'Bottom' : 'Top'} ${d.size} values of ${d.label}`;
    const rm = d.rankBy === 'metric' ? metrics?.find((m) => m.id === d.rankMetric) : undefined;
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
const OPS: readonly MetricOp[] = ['count', 'median', 'avg', 'sum', 'min', 'max', 'unique', 'percentile', 'formula'];

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
    const okName = (n: unknown) => n === undefined || (str(n) && (n as string).length <= MAX_NAME);
    const okPct = (p: unknown) => p === undefined || (typeof p === 'number' && Number.isFinite(p) && p >= 1 && p <= 99);
    const buckets = (v.buckets as BucketDim[])
      .filter(
        (b) =>
          b &&
          str(b.id) &&
          str(b.field) &&
          str(b.label) &&
          okName(b.name) &&
          ((b.kind === 'date_histogram' && isIntervalValue(b.interval)) ||
            (b.kind === 'terms' && Number.isInteger(b.size) && b.size > 0) ||
            b.kind === 'range' ||
            (b.kind === 'filters' && b.field === '' && Array.isArray(b.filters)))
      )
      .map((b): BucketDim => {
        switch (b.kind) {
          case 'terms':
            return cleanTerms(b);
          case 'range':
            return cleanRange(b);
          case 'filters':
            return cleanFilters(b);
          default:
            return cleanDateHistogram(b);
        }
      });
    const metrics = (v.metrics as MetricDim[])
      .filter(
        (m) =>
          m &&
          m.kind === 'metric' &&
          str(m.id) &&
          OPS.includes(m.op) &&
          (m.op === 'formula'
            ? str(m.formula) && (m.formula as string).length <= MAX_FORMULA_LEN
            : m.op === 'count' || str(m.field)) &&
          okName(m.name) &&
          okPct(m.percentile)
      )
      .map((m): MetricDim =>
        m.op === 'formula'
          ? {
              kind: 'metric',
              id: m.id,
              op: 'formula',
              formula: m.formula,
              formulaFields: cleanFormulaFields(m.formulaFields) ?? {},
              name: m.name,
            }
          : m
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
  // Filters buckets have no field: their queries go through the KQL compiler like the search bar.
  const kept = s.buckets.filter((b) => b.kind === 'filters' || allowed.has(b.field));
  const metrics = s.metrics.filter((m) =>
    m.op === 'formula'
      ? formulaAllowed(m, allowed)
      : m.op === 'count' || (m.field !== undefined && allowed.has(m.field))
  );
  // A rank metric that no longer exists falls back to ranking by count.
  const ids = new Set(metrics.map((m) => m.id));
  const buckets = kept.map((b) =>
    b.kind === 'terms' && b.rankBy === 'metric' && !(b.rankMetric && ids.has(b.rankMetric))
      ? { ...b, rankBy: undefined, rankMetric: undefined }
      : b
  );
  if (
    kept.length === s.buckets.length &&
    metrics.length === s.metrics.length &&
    buckets.every((b, i) => b === kept[i])
  ) {
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
