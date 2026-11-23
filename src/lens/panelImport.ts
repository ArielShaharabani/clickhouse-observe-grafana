/**
 * "Edit in Visualize" for any dashboard panel (R6-PANELS, LENS-SAVE-02).
 *
 * `importPanel` turns a dashboard panel (untrusted JSON) and the data views into a Visualize chart:
 * the matching data view, a Lens state, a search and filter pills, plus `notes` — everything that was
 * not carried over. Pure and conservative: when the panel holds something Visualize cannot show the
 * same way it either says so in `notes` (kind `partial`) or gives up with a `reason` (kind
 * `unsupported`); it never returns a different chart without saying so.
 *
 * The SQL is read by `sqlRead.ts` into a syntax tree and only ever turned into Lens dimensions
 * (fields, intervals, metric functions) and filter pills; no parsed text goes back into SQL except
 * through the usual cleaners (`decodeLens`, `sanitizeLens` in `finishImport`, `sanitizeFilterPills`,
 * the filter compilers). The dashboard JSON is untrusted.
 */
import { CH_DATASOURCE_TYPE } from '../data/panelExport';
import { DISCOVER_SOURCE_KEY } from '../data/discoverSource';
import { sanitizeFilterPills } from '../sql/filters';
import { quoteString } from '../sql/queryBuilder';
import { DataView, FilterPill } from '../types';
import { clampPercentile, ChartType, decodeLens, dropMissingRankMetric, EMPTY_LENS, encodeLens, LensField, LensState, MAX_NAME, MetricDim, newDimId, sanitizeLens, BucketDim, TermsDim, XySubType } from './state';
import { Expr, exprKey, readSelect, SelectQuery, SqlReadError } from './sqlRead';
import { parseInterval } from './interval';
import { switchChart } from './suggest';
import { ValueFormat } from './metricOptions';
import { chartEdited, panelEdits, VISUALIZE_SIG_KEY, VISUALIZE_SOURCE_KEY, withoutEditLink } from './panelSource';

export interface PanelImport {
  /** ok: nothing lost; partial: converted with the `notes` lost; unsupported: no chart, `reason` says why. */
  kind: 'ok' | 'partial' | 'unsupported';
  reason?: string;
  view?: DataView;
  lens?: LensState;
  search: string;
  filters: FilterPill[];
  /** What was not carried over (and so is lost when the chart replaces the panel). */
  notes: string[];
  title: string;
  description: string;
  /** The panel's query as text (SQL, or the builder options as JSON), for the read-only view. */
  originalQuery: string;
  /** The panel is a library panel reference (replacing it makes it a regular panel). */
  library?: boolean;
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const str = (x: unknown, max = 500): string => (typeof x === 'string' ? x.slice(0, max) : '');
const MAX_QUERY_TEXT = 20_000;

/** Panel types Visualize can draw, and the chart each becomes. */
const SUPPORTED_TYPES = ['timeseries', 'barchart', 'piechart', 'stat', 'gauge', 'bargauge', 'table', 'heatmap'];

/** Stable JSON (sorted keys) for comparing settings with their defaults. */
export function canon(x: unknown): string {
  if (Array.isArray(x)) {
    return `[${x.map(canon).join(',')}]`;
  }
  if (isObj(x)) {
    return `{${Object.keys(x)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canon(x[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(x) ?? 'null';
}
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const isEmptyish = (x: unknown) => x === undefined || x === null || x === '' || (Array.isArray(x) && x.length === 0) || (isObj(x) && Object.keys(x).length === 0);

// ── settings Visualize does not carry ─────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 80 }] };
/** Grafana's defaults for the `custom` options (a panel made in the UI has all of them). */
const DEFAULT_CUSTOM: Record<string, unknown> = {
  axisBorderShow: false,
  axisCenteredZero: false,
  axisColorMode: 'text',
  axisLabel: '',
  axisPlacement: 'auto',
  barAlignment: 0,
  barWidthFactor: 0.6,
  gradientMode: 'none',
  hideFrom: { legend: false, tooltip: false, viz: false },
  insertNulls: false,
  lineInterpolation: 'linear',
  lineStyle: { fill: 'solid' },
  pointSize: 5,
  scaleDistribution: { type: 'linear' },
  thresholdsStyle: { mode: 'off' },
  spanNulls: false,
  showPoints: 'auto',
  lineWidth: 1,
  fillOpacity: 0,
  stacking: { mode: 'none', group: 'A' },
  drawStyle: 'line',
  // Table defaults.
  align: 'auto',
  cellOptions: { type: 'auto' },
  inspect: false,
  filterable: false,
  wrapHeaderText: true,
};
/** `custom` keys this importer maps to the chart (so they are not lost). */
const CARRIED_CUSTOM = new Set(['drawStyle', 'fillOpacity', 'stacking']);
const OPTION_DEFAULTS: Record<string, unknown[]> = {
  tooltip: [{ mode: 'single', sort: 'none' }, { mode: 'multi', sort: 'desc' }, { mode: 'single', sort: 'none', hideZeros: false }],
  reduceOptions: [
    { values: false, calcs: ['lastNotNull'], fields: '' },
    { values: true, calcs: [], fields: '' },
  ],
  textMode: ['auto', 'value_and_name'],
  colorMode: ['value', 'none'],
  graphMode: ['area', 'none'],
  justifyMode: ['auto'],
  orientation: ['auto'],
  wideLayout: [true],
  showPercentChange: [false],
  percentChangeColorMode: ['standard'],
  text: [{}],
  showThresholdLabels: [false],
  showThresholdMarkers: [true],
  sizing: ['auto'],
  minVizHeight: [75, 200],
  minVizWidth: [75, 200],
  namePlacement: ['auto'],
  valueMode: ['color'],
  showUnfilled: [true],
  displayMode: ['gradient', 'basic', 'lcd'],
  displayLabels: [[]],
  showHeader: [true],
  cellHeight: ['sm'],
  footer: [{ show: false, reducer: ['sum'], countRows: false, fields: '' }],
  enablePagination: [true, false],
  stacking: ['none', 'normal', 'percent'],
  xField: [],
  showValue: ['auto', 'never'],
  xTickLabelRotation: [0],
  xTickLabelMaxLength: [0],
  xTickLabelSpacing: [0],
  barWidth: [0.97],
  groupWidth: [0.7],
  fullHighlight: [false],
  pieType: ['pie', 'donut'],
  legend: [],
};
/** Top-level panel keys that are not settings of the chart itself. */
const PLAIN_PANEL_KEYS = new Set([
  'id', 'gridPos', 'title', 'type', 'datasource', 'targets', 'options', 'fieldConfig', 'description', 'pluginVersion',
  'libraryPanel', 'maxDataPoints', 'transformations',
]);

/** Panel settings the chart import does not carry over (they are dropped when the panel is replaced). */
export function lostSettings(p: Record<string, unknown>, chart: ChartType | undefined, hasDate: boolean): string[] {
  const lost: string[] = [];
  for (const k of Object.keys(p)) {
    if (!PLAIN_PANEL_KEYS.has(k) && !isEmptyish(p[k])) {
      lost.push(`Panel setting "${k.slice(0, 40)}"`);
    }
  }
  if (Array.isArray(p.transformations) && p.transformations.length > 0) {
    const ids = p.transformations.map((t) => (isObj(t) ? str(t.id, 40) : '?')).slice(0, 6);
    lost.push(`Transformations (${ids.join(', ')})`);
  }
  if (typeof p.maxDataPoints === 'number' && hasDate && p.maxDataPoints !== 60) {
    lost.push(`Max data points (${String(p.maxDataPoints).slice(0, 10)})`);
  }
  const fc = isObj(p.fieldConfig) ? p.fieldConfig : {};
  if (Array.isArray(fc.overrides) && fc.overrides.length > 0) {
    lost.push(`Field overrides (${fc.overrides.length})`);
  }
  for (const k of Object.keys(fc)) {
    if (k !== 'defaults' && k !== 'overrides' && !isEmptyish(fc[k])) {
      lost.push(`Field config "${k.slice(0, 40)}"`);
    }
  }
  const d = isObj(fc.defaults) ? fc.defaults : {};
  for (const [k, v] of Object.entries(d)) {
    if (isEmptyish(v) || k === 'unit' || k === 'decimals') {
      continue;
    }
    if (k === 'thresholds') {
      if (!same(v, DEFAULT_THRESHOLDS)) {
        lost.push('Thresholds');
      }
    } else if (k === 'color') {
      if (!(isObj(v) && ['palette-classic', 'thresholds'].includes(str(v.mode, 40)) && Object.keys(v).length === 1)) {
        lost.push('Color scheme');
      }
    } else if (k === 'custom') {
      if (isObj(v)) {
        for (const [ck, cv] of Object.entries(v)) {
          if (!CARRIED_CUSTOM.has(ck) && !(ck in DEFAULT_CUSTOM && same(cv, DEFAULT_CUSTOM[ck])) && !isEmptyish(cv)) {
            lost.push(`Custom option "${ck.slice(0, 40)}"`);
          }
        }
      }
    } else if ((k === 'min' || k === 'max') && chart === 'gauge') {
      // carried to the gauge options
    } else {
      lost.push(`Field option "${k.slice(0, 40)}"`);
    }
  }
  const o = isObj(p.options) ? p.options : {};
  for (const [k, v] of Object.entries(o)) {
    if (isEmptyish(v) || k === 'legend') {
      continue;
    }
    if (k === 'orientation' && chart === 'bar' && v === 'horizontal') {
      continue;
    }
    const defaults = OPTION_DEFAULTS[k];
    if (!(defaults && defaults.some((x) => same(x, v)))) {
      lost.push(`Option "${k.slice(0, 40)}"`);
    }
  }
  const lg = isObj(o.legend) ? o.legend : {};
  for (const [k, v] of Object.entries(lg)) {
    if (k === 'showLegend' || (k === 'placement' && (v === 'bottom' || v === 'right')) || isEmptyish(v)) {
      continue;
    }
    if (k === 'displayMode' && v === 'list') {
      continue;
    }
    if (chart === 'pie' || chart === 'donut') {
      continue; // pie legends keep Visualize's own list with values
    }
    lost.push(`Legend option "${k.slice(0, 40)}"`);
  }
  return lost;
}

// ── expressions ───────────────────────────────────────────────────────────────────────────────────

/** Display-only text of an expression (for notes). */
export function exprText(e: Expr, depth = 0): string {
  if (depth > 6) {
    return '…';
  }
  switch (e.t) {
    case 'col':
      return e.parts.join('.');
    case 'idx':
      return `${exprText(e.base, depth + 1)}['${e.key}']`;
    case 'num':
      return e.v;
    case 'str':
      return `'${e.v}'`;
    case 'star':
      return '*';
    case 'call':
      return `${e.name}(${e.args.map((a) => exprText(a, depth + 1)).join(', ')})`;
    case 'macro':
      return `$__${e.name}${e.args.length ? `(${e.args.map((a) => exprText(a, depth + 1)).join(', ')})` : ''}`;
    case 'bin':
      return `${exprText(e.l, depth + 1)} ${e.op} ${exprText(e.r, depth + 1)}`;
    case 'un':
      return `${e.op}${exprText(e.e, depth + 1)}`;
    case 'and':
    case 'or':
      return e.items.map((i) => exprText(i, depth + 1)).join(e.t === 'and' ? ' AND ' : ' OR ');
    case 'not':
      return `NOT ${exprText(e.e, depth + 1)}`;
    case 'in':
      return `${exprText(e.e, depth + 1)} ${e.neg ? 'NOT ' : ''}IN (${e.list.map((a) => exprText(a, depth + 1)).join(', ')})`;
    case 'like':
      return `${exprText(e.e, depth + 1)} ${e.neg ? 'NOT ' : ''}${e.ci ? 'ILIKE' : 'LIKE'} ${exprText(e.pat, depth + 1)}`;
    case 'between':
      return `${exprText(e.e, depth + 1)} ${e.neg ? 'NOT ' : ''}BETWEEN ${exprText(e.lo, depth + 1)} AND ${exprText(e.hi, depth + 1)}`;
    case 'isnull':
      return `${exprText(e.e, depth + 1)} IS ${e.neg ? 'NOT ' : ''}NULL`;
    case 'interval':
      return `INTERVAL ${exprText(e.n, depth + 1)} ${e.unit}`;
  }
}
const short = (s: string) => (s.length > 80 ? `${s.slice(0, 77)}…` : s);

interface Ctx {
  q: SelectQuery;
  view: DataView;
}

/** Field text Lens uses for a column, Map key or JSON / tuple path; null for anything else. */
function fieldOf(e: Expr, q: SelectQuery): string | null {
  if (e.t === 'col') {
    let parts = e.parts;
    if (parts.length > 1 && (parts[0] === q.tableAlias || (parts[0] === q.table && q.tableAlias === undefined))) {
      parts = parts.slice(1);
    } else if (parts.length > 2 && q.database !== undefined && parts[0] === q.database && parts[1] === q.table) {
      parts = parts.slice(2);
    }
    return parts.join('.').slice(0, 1000);
  }
  if (e.t === 'idx') {
    const base = fieldOf(e.base, q);
    return base !== null && e.base.t === 'col' && !base.includes('.') ? `${base}[${quoteString(e.key)}]` : null;
  }
  return null;
}

const INTERVAL_UNITS: Record<string, string> = {
  second: 's', seconds: 's', minute: 'm', minutes: 'm', hour: 'h', hours: 'h', day: 'd', days: 'd', week: 'w', weeks: 'w',
  month: 'M', months: 'M', year: 'y', years: 'y', millisecond: 'ms', milliseconds: 'ms',
};
const START_OF: Record<string, string> = {
  tostartofsecond: '1s', tostartofminute: '1m', tostartoffiveminutes: '5m', tostartoftenminutes: '10m',
  tostartoffifteenminutes: '15m', tostartofhour: '1h', tostartofday: '1d', tostartofweek: '1w', tostartofmonth: '1M',
  tostartofquarter: '3M', tostartofyear: '1y',
};

/** A date bucket expression → its column and interval, or a reason. */
function timeBucketOf(e: Expr, q: SelectQuery): { field: string; interval: string } | null {
  if (e.t === 'macro' && e.name === 'timeInterval' && e.args.length === 1) {
    const f = fieldOf(e.args[0], q);
    return f ? { field: f, interval: 'auto' } : null;
  }
  if (e.t !== 'call') {
    return null;
  }
  const name = e.name.toLowerCase();
  if (name === 'tostartofinterval' && e.args.length === 2) {
    const f = fieldOf(e.args[0], q);
    const iv = e.args[1];
    if (!f || iv.t !== 'interval') {
      return null;
    }
    const unit = INTERVAL_UNITS[iv.unit];
    if (iv.n.t === 'macro' && /^interval/i.test(iv.n.name)) {
      return { field: f, interval: 'auto' };
    }
    if (iv.n.t === 'num' && unit && parseInterval(`${iv.n.v}${unit}`)) {
      return { field: f, interval: `${iv.n.v}${unit}` };
    }
    return null;
  }
  const iv = START_OF[name];
  if (iv && e.args.length === 1) {
    const f = fieldOf(e.args[0], q);
    return f ? { field: f, interval: iv } : null;
  }
  return null;
}

const NUM_CASTS = /^(tofloat(32|64)|toint(8|16|32|64)|touint(8|16|32|64)|todecimal(32|64))$/i;
const UNIQ = new Set(['uniq', 'uniqexact', 'uniqcombined', 'uniqcombined64', 'uniqhll12', 'uniqthetasketch']);
const QUANTILE = /^quantile(exact|tdigest|timing|exactlow|exacthigh|deterministic|bfloat16)?$/i;

/** A metric expression → a Lens metric (field filled later), or the reason it cannot be one. */
function metricOf(e: Expr, q: SelectQuery): { m: MetricDim } | { why: string } | { many: MetricDim[] } {
  if (e.t !== 'call') {
    return { why: 'not an aggregate function' };
  }
  const name = e.name.toLowerCase();
  const id = newDimId('m');
  if (e.params && !(QUANTILE.test(name) || name === 'quantiles' || /^quantiles/.test(name))) {
    return { why: `${e.name}(…)(…) is not supported` };
  }
  const arg0 = e.args[0];
  const fieldArg = (): string | null => {
    if (e.args.length !== 1) {
      return null;
    }
    let a = e.args[0];
    if (a.t === 'call' && NUM_CASTS.test(a.name) && a.args.length === 1) {
      a = a.args[0];
    }
    return fieldOf(a, q);
  };
  const withField = (op: MetricDim['op'], extra: Partial<MetricDim> = {}): { m: MetricDim } | { why: string } => {
    const f = fieldArg();
    return f ? { m: { kind: 'metric', id, op, field: f, fieldLabel: f, numeric: false, ...extra } } : { why: `${e.name}() of an expression is not supported` };
  };
  if (name === 'count') {
    if (e.distinct) {
      return withField('unique');
    }
    const plain = e.args.length === 0 || (e.args.length === 1 && (arg0.t === 'star' || (arg0.t === 'num' && arg0.v === '1')));
    return plain ? { m: { kind: 'metric', id, op: 'count' } } : { why: 'count(column) counts non-empty values, which Visualize does not' };
  }
  if (e.distinct) {
    return { why: 'DISTINCT is only supported inside count()' };
  }
  if (UNIQ.has(name)) {
    return withField('unique');
  }
  if (name === 'sum' || name === 'avg' || name === 'min' || name === 'max' || name === 'median') {
    return withField(name);
  }
  if (name === 'stddevpop') {
    return withField('std_dev');
  }
  if (QUANTILE.test(name) && e.params?.length === 1) {
    const lv = e.params[0];
    const pct = lv.t === 'num' ? Math.round(Number(lv.v) * 1e6) / 1e4 : NaN;
    if (!Number.isInteger(pct) || pct < 1 || pct > 99) {
      return { why: `quantile level ${lv.t === 'num' ? lv.v : '?'} is not a whole percentile between 1 and 99` };
    }
    return withField('percentile', { percentile: clampPercentile(pct) });
  }
  if (/^quantiles/.test(name) && e.params && e.params.length > 0) {
    const out: MetricDim[] = [];
    for (const lv of e.params) {
      const pct = lv.t === 'num' ? Math.round(Number(lv.v) * 1e6) / 1e4 : NaN;
      if (!Number.isInteger(pct) || pct < 1 || pct > 99) {
        return { why: 'quantiles(…) with a level that is not a whole percentile between 1 and 99' };
      }
      const one = withField('percentile', { percentile: pct });
      if (!('m' in one)) {
        return one;
      }
      out.push({ ...one.m, id: newDimId('m') });
    }
    return { many: out };
  }
  return { why: `${e.name}() is not supported` };
}

// ── WHERE → filter pills ──────────────────────────────────────────────────────────────────────────

const NUM_RE = /^-?\d+(\.\d+)?$/;
let pillSeq = 0;
const pillId = () => `imp${(pillSeq++).toString(36)}`;

type Pred = { pill: FilterPill } | { time: string | null } | { note: string; unsupported?: boolean };

function literal(e: Expr): string | null {
  return e.t === 'str' || e.t === 'num' ? e.v : null;
}

function predicate(e: Expr, q: SelectQuery, ts: string): Pred {
  const bad = (): Pred => ({ note: `Condition not carried over: ${short(exprText(e))}` });
  if (e.t === 'macro') {
    if ((e.name === 'timeFilter' || e.name === 'timeFilter_ms') && e.args.length === 1) {
      return { time: fieldOf(e.args[0], q) };
    }
    return bad();
  }
  const pill = (p: Omit<FilterPill, 'id' | 'value'> & { value?: string }): Pred => ({ pill: { id: pillId(), value: '', ...p } });
  if (e.t === 'bin') {
    const f = fieldOf(e.l, q);
    if (!f) {
      return bad();
    }
    if (e.r.t === 'macro' && (e.r.name === 'fromTime' || e.r.name === 'toTime') && ['>=', '>', '<=', '<'].includes(e.op)) {
      return { time: f };
    }
    const v = literal(e.r);
    if (v === null) {
      return bad();
    }
    if ((e.op === '=' || e.op === '!=') && v !== '') {
      return pill({ field: f, op: e.op, value: v });
    }
    if ((e.op === '>=' || e.op === '<') && NUM_RE.test(v)) {
      return pill({ field: f, op: e.op === '>=' ? 'gte' : 'lt', value: v });
    }
    return bad();
  }
  if (e.t === 'in') {
    const f = fieldOf(e.e, q);
    const vals = e.list.map(literal);
    if (!f || vals.length === 0 || vals.length > 100 || vals.some((v) => v === null || v === '')) {
      return bad();
    }
    return pill({ field: f, op: e.neg ? 'not_one_of' : 'one_of', value: '', values: vals as string[] });
  }
  if (e.t === 'like') {
    const f = fieldOf(e.e, q);
    const pat = e.pat.t === 'str' ? e.pat.v : null;
    const m = pat !== null ? /^%([^%_\\]+)%$/.exec(pat) : null;
    if (!f || !m) {
      return bad();
    }
    const p = pill({ field: f, op: e.neg ? 'not_contains' : 'contains', value: m[1] });
    return e.ci ? p : { ...p, note: 'LIKE is case sensitive in ClickHouse; the filter is not' } as Pred;
  }
  if (e.t === 'between') {
    const f = fieldOf(e.e, q);
    const lo = literal(e.lo);
    const hi = literal(e.hi);
    if (!f || lo === null || hi === null || !NUM_RE.test(lo) || !NUM_RE.test(hi)) {
      return bad();
    }
    return pill({ field: f, op: e.neg ? 'not_between' : 'between', value: '', values: [lo, hi] });
  }
  if (e.t === 'isnull') {
    const f = fieldOf(e.e, q);
    return f ? pill({ field: f, op: e.neg ? 'exists' : 'not_exists' }) : bad();
  }
  void ts;
  return bad();
}

// ── the query → a chart ───────────────────────────────────────────────────────────────────────────

interface Spec {
  q: SelectQuery;
  original: string;
}

/** The target's query as the same select shape (SQL editor: read the SQL; builder: its options). */
function specOf(target: Record<string, unknown>): Spec {
  if (target.editorType === 'builder' && isObj(target.builderOptions)) {
    const b = target.builderOptions;
    return { q: builderQuery(b), original: JSON.stringify(b).slice(0, MAX_QUERY_TEXT) };
  }
  const sql = str(target.rawSql, MAX_QUERY_TEXT + 1);
  if (!sql.trim()) {
    throw new SqlReadError('The query is empty');
  }
  if (sql.length > MAX_QUERY_TEXT) {
    throw new SqlReadError('The SQL is too long');
  }
  return { q: readSelect(sql), original: sql };
}

const col = (name: string): Expr => ({ t: 'col', parts: [name] });
const BUILDER_AGG: Record<string, string> = {
  count: 'count', sum: 'sum', avg: 'avg', min: 'min', max: 'max', uniq: 'uniq', uniqexact: 'uniqExact', median: 'median',
  stddevpop: 'stddevPop',
};

/** Builder options (aggregate / trend mode) as the equivalent select. */
function builderQuery(b: Record<string, unknown>): SelectQuery {
  if (b.mode === 'list' || !Array.isArray(b.aggregates) || b.aggregates.length === 0) {
    throw new SqlReadError('The query lists rows instead of aggregating them');
  }
  const table = str(b.table, 200);
  if (!table) {
    throw new SqlReadError('The query builder has no table');
  }
  const items: SelectQuery['items'] = [];
  const cols = Array.isArray(b.columns) ? b.columns : [];
  const groupBy: Expr[] = [];
  const groupNames = Array.isArray(b.groupBy) ? b.groupBy.map((g) => str(g, 200)).filter(Boolean) : [];
  for (const c of cols) {
    if (isObj(c) && str(c.name, 200)) {
      const e = col(str(c.name, 200));
      items.push({ expr: c.hint === 'time' ? { t: 'macro', name: 'timeInterval', args: [e] } : e, alias: str(c.alias, 100) || undefined });
    }
  }
  if (b.mode === 'trend' && !items.some((i) => i.expr.t === 'macro')) {
    const tc = cols.find((c) => isObj(c) && c.hint === 'time');
    if (!tc) {
      throw new SqlReadError('The trend query has no time column');
    }
  }
  for (const g of groupNames) {
    groupBy.push(col(g));
    if (!items.some((i) => i.expr.t === 'col' && i.expr.parts[0] === g)) {
      items.push({ expr: col(g) });
    }
  }
  for (const a of b.aggregates) {
    if (!isObj(a)) {
      throw new SqlReadError('Bad aggregate');
    }
    const fn = BUILDER_AGG[str(a.aggregateType, 40).toLowerCase()];
    if (!fn) {
      throw new SqlReadError(`The aggregate ${str(a.aggregateType, 40)} is not supported`);
    }
    const column = str(a.column, 200);
    items.push({
      expr: { t: 'call', name: fn, args: fn === 'count' && !column ? [] : [col(column)] },
      alias: str(a.alias, 100) || undefined,
    });
  }
  for (const it of items.filter((i) => i.expr.t === 'macro')) {
    groupBy.unshift(it.expr);
  }
  const filters: Expr[] = [];
  const bf = Array.isArray(b.filters) ? b.filters : [];
  for (const f of bf) {
    if (!isObj(f)) {
      continue;
    }
    const key = str(f.key, 200);
    const op = str(f.operator, 40).toUpperCase();
    const val = f.value;
    if (op === 'WITH IN DASHBOARD TIME RANGE') {
      filters.push({ t: 'macro', name: 'timeFilter', args: [col(key)] });
      continue;
    }
    if (f.condition === 'OR') {
      throw new SqlReadError('The builder filters use OR');
    }
    const lit = (v: unknown): Expr => (typeof v === 'number' ? { t: 'num', v: String(v) } : { t: 'str', v: str(v, 500) });
    const tl: Expr = col(key);
    if (['=', '!=', '<', '>', '<=', '>='].includes(op)) {
      filters.push({ t: 'bin', op, l: tl, r: lit(val) });
    } else if (op === 'IN' || op === 'NOT IN') {
      filters.push({ t: 'in', e: tl, list: (Array.isArray(val) ? val : [val]).slice(0, 100).map(lit), neg: op === 'NOT IN' });
    } else if (op === 'LIKE' || op === 'NOT LIKE' || op === 'ILIKE' || op === 'NOT ILIKE') {
      filters.push({ t: 'like', e: tl, pat: lit(val), neg: op.startsWith('NOT'), ci: op.endsWith('ILIKE') });
    } else if (op === 'IS NULL' || op === 'IS NOT NULL') {
      filters.push({ t: 'isnull', e: tl, neg: op === 'IS NOT NULL' });
    } else if (op !== 'IS ANYTHING') {
      filters.push({ t: 'macro', name: `unsupported:${op.slice(0, 20)}`, args: [] });
    }
  }
  const orderBy = (Array.isArray(b.orderBy) ? b.orderBy : [])
    .filter(isObj)
    .map((o) => ({ expr: col(str(o.name, 200)), dir: (str(o.dir, 4).toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc' }));
  const limit = typeof b.limit === 'number' && Number.isInteger(b.limit) && b.limit > 0 ? b.limit : undefined;
  return {
    items,
    database: str(b.database, 200) || undefined,
    table,
    groupBy,
    orderBy,
    limit,
    where: filters.length === 0 ? undefined : filters.length === 1 ? filters[0] : { t: 'and', items: filters },
    ignored: [],
  };
}

const TERMS_NO_LIMIT = 20;

/** Matches the query's table to a data view of that data source. */
function matchView(views: DataView[], dsUid: string, q: SelectQuery): DataView | string {
  const sameDs = views.filter((v) => v.datasourceUid === dsUid);
  if (sameDs.length === 0) {
    return 'No data view uses this data source';
  }
  const hits = sameDs.filter((v) => v.logsTable === q.table && (q.database === undefined || v.database === q.database));
  if (hits.length === 0) {
    return `No data view for the table ${q.database ? `${q.database}.` : ''}${q.table}`;
  }
  const dbs = new Set(hits.map((v) => v.database));
  if (dbs.size > 1) {
    return `The table ${q.table} is in several databases: name the database in the query`;
  }
  return hits[0];
}

const target0 = (p: Record<string, unknown>): Record<string, unknown> | undefined =>
  Array.isArray(p.targets) && isObj(p.targets[0]) ? p.targets[0] : undefined;

function dsUidOf(p: Record<string, unknown>, t: Record<string, unknown> | undefined): { uid: string } | string {
  const ds = isObj(t?.datasource) ? t?.datasource : isObj(p.datasource) ? p.datasource : undefined;
  if (!ds) {
    return 'The panel uses the default data source, which cannot be matched to a data view';
  }
  const uid = str(ds.uid, 200);
  if (!uid || /^\$|\[\[/.test(uid)) {
    return 'The data source is a dashboard variable';
  }
  if (ds.type !== undefined && ds.type !== CH_DATASOURCE_TYPE) {
    return `The panel uses another data source (${str(ds.type, 60)})`;
  }
  return { uid };
}

function chartFor(p: Record<string, unknown>): { chart: ChartType; subType?: XySubType; style?: LensState['style']; gauge?: LensState['gauge'] } {
  const type = str(p.type, 40);
  const fc = isObj(p.fieldConfig) ? p.fieldConfig : {};
  const d = isObj(fc.defaults) ? fc.defaults : {};
  const custom = isObj(d.custom) ? d.custom : {};
  const o = isObj(p.options) ? p.options : {};
  const stack = (mode: unknown): XySubType => (mode === 'normal' ? 'stacked' : mode === 'percent' ? 'percentage' : 'unstacked');
  switch (type) {
    case 'timeseries': {
      const bars = custom.drawStyle === 'bars';
      const mode = isObj(custom.stacking) ? custom.stacking.mode : 'none';
      const fill = typeof custom.fillOpacity === 'number' ? custom.fillOpacity : 0;
      if (bars) {
        return { chart: 'bar', subType: stack(mode) };
      }
      return fill > 0 || mode === 'normal' || mode === 'percent'
        ? { chart: 'area', subType: stack(mode) }
        : { chart: 'line' };
    }
    case 'barchart':
      return {
        chart: 'bar',
        subType: stack(o.stacking),
        ...(o.orientation === 'horizontal' ? { style: { orientation: 'horizontal' as const } } : {}),
      };
    case 'piechart':
      return { chart: o.pieType === 'donut' ? 'donut' : 'pie' };
    case 'stat':
      return { chart: 'metric' };
    case 'gauge':
    case 'bargauge': {
      const g: NonNullable<LensState['gauge']> = {};
      if (type === 'bargauge') {
        g.shape = 'bar';
      }
      if (typeof d.min === 'number' && Number.isFinite(d.min) && d.min !== 0) {
        g.min = d.min;
      }
      if (typeof d.max === 'number' && Number.isFinite(d.max)) {
        g.max = d.max;
      }
      return { chart: 'gauge', ...(Object.keys(g).length ? { gauge: g } : {}) };
    }
    case 'table':
      return { chart: 'table' };
    default:
      return { chart: 'heatmap' };
  }
}

/** Unit / decimals → the metrics' value format; settings that have no equivalent go to `notes`. */
function formatFor(p: Record<string, unknown>, notes: string[]): ValueFormat | undefined {
  const fc = isObj(p.fieldConfig) ? p.fieldConfig : {};
  const d = isObj(fc.defaults) ? fc.defaults : {};
  const unit = typeof d.unit === 'string' ? d.unit : undefined;
  const dec = typeof d.decimals === 'number' && Number.isInteger(d.decimals) && d.decimals >= 0 && d.decimals <= 10 ? d.decimals : undefined;
  if (d.decimals !== undefined && dec === undefined) {
    notes.push('Decimals');
  }
  if (!unit || unit === 'locale' || unit === 'short') {
    if (unit === 'short' || dec === undefined) {
      return undefined;
    }
    return { id: 'number', decimals: dec };
  }
  const f = (id: ValueFormat['id'], extra: Partial<ValueFormat> = {}): ValueFormat => ({ id, ...(dec !== undefined ? { decimals: dec } : {}), ...extra });
  switch (unit) {
    case 'none':
      return f('number');
    case 'percentunit':
      return f('percent');
    case 'bytes':
      return f('bytes');
    case 'decbits':
      return f('bits');
    case 'ms':
    case 's':
    case 'm':
    case 'h':
      return { id: 'duration', durationUnit: unit };
    default:
      notes.push(`Unit "${unit.slice(0, 40)}"`);
      return undefined;
  }
}

function legendStyle(p: Record<string, unknown>, chart: ChartType): LensState['style'] | undefined {
  const o = isObj(p.options) ? p.options : {};
  const lg = isObj(o.legend) ? o.legend : undefined;
  if (!lg || !(chart === 'line' || chart === 'area' || chart === 'bar')) {
    return undefined;
  }
  if (lg.showLegend === false) {
    return { legend: { visibility: 'hide' } };
  }
  if (lg.placement === 'right') {
    return { legend: { visibility: 'show', position: 'outside', alignment: 'right' } };
  }
  return undefined;
}

/** Everything that depends on the select (not on the panel type). */
function lensFromQuery(
  { q, view }: Ctx,
  panel: Record<string, unknown>,
  notes: string[]
): { lens: LensState; filters: FilterPill[] } {
  const ts = view.columns.timestamp;
  const buckets: BucketDim[] = [];
  const metrics: MetricDim[] = [];
  const itemKeys: Array<{ key: string; alias?: string; kind: 'bucket' | 'metric'; ref: string }> = [];
  let hasDateBucket = false;
  const aliasOf = (a?: string) => (a && a.length <= MAX_NAME ? a : undefined);
  for (const it of q.items) {
    const tb = timeBucketOf(it.expr, q);
    if (tb) {
      const b: BucketDim = { kind: 'date_histogram', id: newDimId('b'), field: tb.field === ts ? ts : tb.field, label: tb.field, interval: tb.interval };
      buckets.push(b);
      hasDateBucket = true;
      itemKeys.push({ key: exprKey(it.expr), alias: it.alias, kind: 'bucket', ref: b.id });
      continue;
    }
    const f = fieldOf(it.expr, q);
    if (f !== null && it.expr.t !== 'star') {
      const b: TermsDim = { kind: 'terms', id: newDimId('b'), field: f, label: f, size: 9 };
      const name = aliasOf(it.alias);
      if (name && name !== f) {
        b.name = name;
      }
      buckets.push(b);
      itemKeys.push({ key: exprKey(it.expr), alias: it.alias, kind: 'bucket', ref: b.id });
      continue;
    }
    const mm = metricOf(it.expr, q);
    if ('m' in mm || 'many' in mm) {
      const list = 'm' in mm ? [mm.m] : mm.many;
      list.forEach((m, i) => {
        const name = aliasOf(it.alias);
        if (name && list.length === 1) {
          m.name = name;
        }
        metrics.push(m);
        if (i === 0) {
          itemKeys.push({ key: exprKey(it.expr), alias: it.alias, kind: 'metric', ref: m.id });
        }
      });
      if (list.length > 1) {
        notes.push(`${exprText(it.expr)} became ${list.length} separate percentile metrics`);
      }
      continue;
    }
    notes.push(`Column not carried over: ${short(exprText(it.expr))} (${mm.why})`);
  }
  if (metrics.length === 0) {
    throw new SqlReadError(
      buckets.length > 0 || q.items.length === 0 ? 'The query has no aggregate Visualize can compute' : 'The query lists rows instead of aggregating them'
    );
  }
  // GROUP BY must be exactly the selected non-aggregate columns.
  const resolveRef = (e: Expr): string | null => {
    if (e.t === 'num' && /^\d+$/.test(e.v)) {
      const it = q.items[Number(e.v) - 1];
      return it ? exprKey(it.expr) : null;
    }
    if (e.t === 'col' && e.parts.length === 1) {
      const byAlias = q.items.find((i) => i.alias === e.parts[0]);
      if (byAlias) {
        return exprKey(byAlias.expr);
      }
    }
    return exprKey(e);
  };
  const groupKeys = new Set<string>();
  for (const g of q.groupBy) {
    const k = resolveRef(g);
    if (k === null) {
      throw new SqlReadError('GROUP BY refers to a column that is not selected');
    }
    groupKeys.add(k);
  }
  const bucketKeys = new Set(itemKeys.filter((k) => k.kind === 'bucket').map((k) => k.key));
  for (const k of groupKeys) {
    if (!bucketKeys.has(k)) {
      throw new SqlReadError('GROUP BY uses an expression that is not a selected column');
    }
  }
  for (const k of bucketKeys) {
    if (!groupKeys.has(k)) {
      throw new SqlReadError('A selected column is not in GROUP BY');
    }
  }
  // WHERE.
  const pills: FilterPill[] = [];
  let timeFiltered = false;
  if (q.where) {
    const list: Expr[] = [];
    const flat = (e: Expr) => (e.t === 'and' ? e.items.forEach(flat) : list.push(e));
    flat(q.where);
    for (const e of list) {
      if (e.t === 'or') {
        throw new SqlReadError('WHERE uses OR');
      }
      const pr = predicate(e, q, ts);
      if ('pill' in pr) {
        pills.push(pr.pill);
        if ('note' in pr) {
          notes.push((pr as { note: string }).note);
        }
      } else if ('time' in pr) {
        timeFiltered = true;
        if (pr.time !== null && pr.time !== ts) {
          notes.push(`The time filter is on ${short(pr.time)}; Visualize filters on the view's time field (${ts})`);
        }
      } else {
        notes.push(pr.note);
      }
    }
  }
  if (!timeFiltered) {
    notes.push('The query has no time filter; Visualize always applies the time range');
  }
  // Rank / limit of the (first) top-values bucket.
  const terms = buckets.filter((b): b is TermsDim => b.kind === 'terms');
  const order = q.orderBy.filter((o) => {
    const k = resolveRef(o.expr);
    return !(k !== null && itemKeys.some((i) => i.key === k && i.kind === 'bucket' && buckets.find((b) => b.id === i.ref)?.kind === 'date_histogram'));
  });
  if (terms.length > 0) {
    const first = terms[0];
    let ranked = false;
    if (order.length === 1 && terms.length === 1 && !hasDateBucket) {
      const k = resolveRef(order[0].expr);
      const hit = itemKeys.find((i) => i.key === k);
      if (hit?.kind === 'metric') {
        first.rankBy = 'metric';
        first.rankMetric = hit.ref;
        first.rankDir = order[0].dir;
        ranked = true;
      } else if (hit?.ref === first.id) {
        first.rankBy = 'alpha';
        first.rankDir = order[0].dir;
        ranked = true;
      }
    }
    if (order.length > 0 && !ranked) {
      notes.push('ORDER BY not carried over (top values are ranked by count)');
    }
    if (order.length === 0 && q.limit !== undefined) {
      notes.push('No ORDER BY: Visualize ranks the top values by count');
    }
    if (hasDateBucket) {
      if (q.limit !== undefined) {
        notes.push(`LIMIT ${q.limit} limits rows in the query; Visualize shows the top ${first.size} values as series`);
      }
    } else if (q.limit !== undefined) {
      first.size = Math.max(1, Math.min(q.limit, 1000));
    } else {
      first.size = TERMS_NO_LIMIT;
      notes.push(`No LIMIT: Visualize shows the top ${TERMS_NO_LIMIT} values`);
    }
  } else if (q.limit !== undefined && !hasDateBucket && metrics.length > 0 && buckets.length === 0) {
    // a single aggregate row: LIMIT is moot
  }
  for (const k of q.ignored) {
    notes.push(`${k} clause not carried over`);
  }
  // Chart.
  const ch = chartFor(panel);
  const timeSeries = str(panel.type, 20) === 'timeseries';
  if (timeSeries && !hasDateBucket) {
    throw new SqlReadError('A time series panel needs a date bucket column');
  }
  let ordered = buckets;
  if (timeSeries) {
    ordered = [...buckets.filter((b) => b.kind === 'date_histogram'), ...buckets.filter((b) => b.kind !== 'date_histogram')];
  }
  if (hasDateBucket && ['metric', 'gauge', 'pie', 'donut'].includes(ch.chart)) {
    notes.push('The time buckets are not drawn by this chart (the panel reduced them to one value)');
  }
  if (ordered.filter((b) => b.kind === 'date_histogram').length > 1) {
    throw new SqlReadError('Several date buckets are not supported');
  }
  let lens: LensState = { chartType: ch.chart, buckets: ordered, metrics, ...(ch.subType ? { subType: ch.subType } : {}) };
  lens = switchChart(lens, ch.chart, {}, ch.subType);
  if (lens.parked?.metrics?.length) {
    notes.push('Only the first metric is drawn by this chart');
  }
  const dropped = ordered.filter((b) => !lens.buckets.some((x) => x.id === b.id) && !(lens.parked?.buckets ?? []).some((x) => x.id === b.id));
  if (dropped.length > 0) {
    notes.push('Some columns do not fit this chart type and were left out');
  }
  const fmt = formatFor(panel, notes);
  if (fmt) {
    lens = { ...lens, metrics: lens.metrics.map((m) => ({ ...m, format: fmt })) };
  }
  const legend = legendStyle(panel, ch.chart);
  const style = ch.style || legend ? { ...(ch.style ?? {}), ...(legend ?? {}) } : undefined;
  if (style) {
    lens = { ...lens, style };
  }
  if (ch.gauge) {
    lens = { ...lens, gauge: ch.gauge };
  }
  return { lens, filters: pills };
}

const fail = (base: PanelImport, reason: string, extra: Partial<PanelImport> = {}): PanelImport => ({
  ...base,
  ...extra,
  kind: 'unsupported',
  reason,
  notes: [reason],
});

function discoverImport(base: PanelImport, p: Record<string, unknown>, raw: string, views: DataView[]): PanelImport {
  const sp = new URLSearchParams(raw.slice(0, 16_000));
  const view = views.find((v) => v.id === sp.get('ds'));
  const search = (sp.get('q') ?? '').slice(0, 2000);
  let filters: FilterPill[] = [];
  try {
    const arr = JSON.parse(sp.get('filters') ?? '[]');
    filters = Array.isArray(arr) ? sanitizeFilterPills(arr.slice(0, 50)) : [];
  } catch {
    filters = [];
  }
  const ctxBase = { ...base, view, search, filters };
  if (!view) {
    return fail(ctxBase, 'The data view of this Discover panel no longer exists');
  }
  const ts = view.columns.timestamp;
  if (p.type !== 'timeseries' || !ts) {
    return fail(ctxBase, 'This is a Discover logs table, which lists documents; open it in Discover instead');
  }
  const notes: string[] = [];
  const buckets: BucketDim[] = [{ kind: 'date_histogram', id: newDimId('b'), field: ts, label: ts, interval: 'auto' }];
  const bd = sp.get('bd');
  if (bd === 'severity' && view.columns.severity) {
    buckets.push({ kind: 'terms', id: newDimId('b'), field: view.columns.severity, label: view.columns.severity, size: 9, other: true });
  } else if (bd && bd !== 'none') {
    notes.push('The histogram breakdown is not carried over');
  }
  const iv = sp.get('interval');
  if (iv && iv !== 'auto') {
    notes.push('The histogram interval is not carried over');
  }
  const lens: LensState = { chartType: 'bar', subType: 'stacked', buckets, metrics: [{ kind: 'metric', id: newDimId('m'), op: 'count' }] };
  return { ...ctxBase, kind: notes.length ? 'partial' : 'ok', lens, notes, originalQuery: raw.slice(0, MAX_QUERY_TEXT) };
}

/**
 * Panel JSON (untrusted) + data views → a Visualize chart, or why it cannot be one. A panel made in
 * Visualize whose query or type was then edited in Grafana is read as it is now; when that cannot
 * be converted, it opens on its saved chart, with the edits as what replacing it would lose.
 */
export function importPanel(raw: unknown, views: DataView[]): PanelImport {
  const p = isObj(raw) ? withoutEditLink(raw) : {};
  const t = Array.isArray(p.targets) ? p.targets.find(isObj) : undefined;
  const edits = t && typeof t[VISUALIZE_SOURCE_KEY] === 'string' ? panelEdits(p) : [];
  if (!t || !chartEdited(edits)) {
    const r = readPanel(p, views);
    return edits.length > 0 && r.kind !== 'unsupported' ? { ...r, kind: 'partial', notes: [...r.notes, ...edits] } : r;
  }
  const { [VISUALIZE_SOURCE_KEY]: _source, [VISUALIZE_SIG_KEY]: _sig, ...plain } = t;
  const now = readPanel({ ...p, targets: (p.targets as unknown[]).map((x) => (x === t ? plain : x)) }, views);
  if (now.kind !== 'unsupported') {
    return now;
  }
  const saved = readPanel({ ...p, type: 'table', targets: [{ ...t, hide: false }] }, views);
  return saved.kind === 'unsupported' ? now : { ...saved, kind: 'partial', notes: [...saved.notes, ...edits] };
}

function readPanel(p: Record<string, unknown>, views: DataView[]): PanelImport {
  const t = target0(p);
  const base: PanelImport = {
    kind: 'ok',
    search: '',
    filters: [],
    notes: [],
    title: str(p.title, 200),
    description: str(p.description, 2000),
    originalQuery: typeof t?.rawSql === 'string' ? t.rawSql.slice(0, MAX_QUERY_TEXT) : '',
    ...(isObj(p.libraryPanel) ? { library: true } : {}),
  };
  const type = str(p.type, 40);
  try {
    if (!type) {
      return fail(base, 'The panel has no type (a library panel that could not be loaded)');
    }
    if (!SUPPORTED_TYPES.includes(type)) {
      return fail(base, `Panel type "${type}" is not supported`);
    }
    const targets = Array.isArray(p.targets) ? p.targets : [];
    if (targets.length === 0) {
      return fail(base, 'The panel has no query');
    }
    if (targets.length > 1) {
      return fail(base, 'The panel has several queries');
    }
    if (!t) {
      return fail(base, 'The panel query could not be read');
    }
    if (t.hide === true) {
      return fail(base, 'The panel query is hidden');
    }
    const lib = base.library ? ['Library panel: it becomes a regular panel on this dashboard (the library panel itself is not changed)'] : [];
    // Panels made by Visualize / Discover carry their state.
    if (typeof t[VISUALIZE_SOURCE_KEY] === 'string') {
      const sp = new URLSearchParams((t[VISUALIZE_SOURCE_KEY] as string).slice(0, 16_000));
      const lens = decodeLens(sp.get('lens'));
      const view = views.find((v) => v.id === sp.get('ds'));
      if (!lens || !view) {
        return fail(base, 'The saved Visualize state of this panel could not be read');
      }
      let filters: FilterPill[] = [];
      try {
        const arr = JSON.parse(sp.get('filters') ?? '[]');
        filters = Array.isArray(arr) ? sanitizeFilterPills(arr.slice(0, 50)) : [];
      } catch {
        filters = [];
      }
      return { ...base, view, lens, search: (sp.get('q') ?? '').slice(0, 2000), filters, notes: lib, kind: lib.length ? 'partial' : 'ok' };
    }
    if (typeof t[DISCOVER_SOURCE_KEY] === 'string') {
      const r = discoverImport(base, p, t[DISCOVER_SOURCE_KEY] as string, views);
      return r.kind === 'ok' && lib.length ? { ...r, kind: 'partial', notes: lib } : r;
    }
    const ds = dsUidOf(p, t);
    if (typeof ds === 'string') {
      return fail(base, ds);
    }
    const { q, original } = specOf(t);
    const withQuery = { ...base, originalQuery: original };
    const view = matchView(views, ds.uid, q);
    if (typeof view === 'string') {
      return fail(withQuery, view);
    }
    const notes: string[] = [];
    const { lens, filters } = lensFromQuery({ q, view }, p, notes);
    const hasDate = lens.buckets.some((b) => b.kind === 'date_histogram');
    const lost = lostSettings(p, lens.chartType, hasDate);
    const all = [...notes, ...lost, ...lib];
    // The cleaners: anything they drop is a loss, never silent.
    const cleaned = decodeLens(encodeLens(lens));
    if (!cleaned || cleaned.buckets.length !== lens.buckets.length || cleaned.metrics.length !== lens.metrics.length) {
      return fail(withQuery, 'The chart could not be converted', { view });
    }
    const clean = sanitizeFilterPills(filters);
    if (clean.length !== filters.length) {
      all.push('Some filters could not be carried over');
    }
    return { ...withQuery, view, lens: cleaned, filters: clean, notes: all, kind: all.length ? 'partial' : 'ok' };
  } catch (e) {
    if (e instanceof SqlReadError) {
      return fail(base, `The query can't be converted: ${e.message}`, { view: undefined });
    }
    return fail(base, 'The panel could not be converted');
  }
}

/**
 * Last step on the Visualize page, once the data view's fields are known: keeps only dimensions on
 * fields that exist (what the URL sanitizer would do silently is reported as a note here), sets each
 * field's label and whether it is numeric from the discovered field, and runs `sanitizeLens`.
 */
export function finishImport(
  lens: LensState,
  fields: LensField[],
  timestamp: string
): { lens: LensState; notes: string[] } {
  const byExpr = new Map(fields.map((f) => [f.sqlExpr, f]));
  const notes: string[] = [];
  const known = (e: string) => byExpr.has(e) || e === timestamp;
  const buckets = lens.buckets.flatMap((b): BucketDim[] => {
    if (b.kind === 'filters') {
      return [b];
    }
    if (!known(b.field)) {
      notes.push(`The column "${b.field.slice(0, 60)}" does not exist in the data view; its dimension was left out`);
      return [];
    }
    const f = byExpr.get(b.field);
    return [{ ...b, label: f?.label ?? b.label }];
  });
  const metrics = lens.metrics.flatMap((m): MetricDim[] => {
    if (m.op === 'count' || m.field === undefined) {
      return [m];
    }
    const f = byExpr.get(m.field);
    if (!f) {
      notes.push(`The column "${m.field.slice(0, 60)}" does not exist in the data view; its metric was left out`);
      return [];
    }
    return [{ ...m, fieldLabel: f.label, numeric: f.type === 'number' }];
  });
  const allowed = new Set([...fields.map((f) => f.sqlExpr), ...(timestamp ? [timestamp] : [])]);
  const out = metrics.length === 0 ? EMPTY_LENS : sanitizeLens(dropMissingRankMetric({ ...lens, buckets, metrics }), allowed);
  if (metrics.length === 0) {
    notes.push('No metric could be converted');
  }
  return { lens: out, notes };
}

/** The Visualize URL parameters (chart, search, filters, data view) of an import. */
export function importParams(r: PanelImport): URLSearchParams {
  const sp = new URLSearchParams();
  if (r.lens) {
    sp.set('lens', encodeLens(r.lens));
  }
  if (r.search) {
    sp.set('q', r.search);
  }
  if (r.filters.length > 0) {
    sp.set('filters', JSON.stringify(r.filters));
  }
  if (r.view) {
    sp.set('ds', r.view.id);
  }
  return sp;
}

/** What replacing the panel with the chart loses, for the warning dialog; empty when nothing. */
export function lossList(r: PanelImport): string[] {
  if (r.kind === 'ok') {
    return [];
  }
  return r.kind === 'unsupported'
    ? [r.reason ?? 'The panel cannot be converted', 'The original query and the panel settings']
    : r.notes;
}
