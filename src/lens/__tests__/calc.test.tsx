/**
 * LENS-CALC-01: Standard deviation, Last value, the time-series calculations (Cumulative sum,
 * Differences, Moving average, Counter rate) and the formula's time-series / overall_* functions.
 *
 * The expected numbers in "numbers (fixture)" are the rows ClickHouse 26.3 returned for the compiled
 * SQL on the fixture table (`spec_logs`, macros expanded to 2026-01-01..08 UTC).
 */
import React, { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens, shapeLensRows } from '../compile';
import { DimensionEditor, toFormula } from '../DimensionEditor';
import { withOp, withRefOp, withWindow } from '../dimensions';
import { clampWindow, counterRateSql, cumulativeSumSql, differencesSql, movingAverageSql } from '../calc';
import { formulaErrors, formulaTimeSeriesFns, formulaToSql, formulaUsesWindow } from '../formula';
import { buildLensPanel } from '../panelExport';
import {
  autoLabelIn,
  BucketDim,
  calculationError,
  decodeLens,
  encodeLens,
  isRankable,
  LensField,
  LensState,
  MetricDim,
  sanitizeLens,
  TermsDim,
} from '../state';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const from = dateTime(Date.UTC(2026, 0, 1));
const to = dateTime(Date.UTC(2026, 0, 8));
const range = { from, to, raw: { from, to } };
const conds = ['Timestamp >= $__fromTime AND Timestamp <= $__toTime'];
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);

const date: BucketDim = { kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: '1d' };
const svc: TermsDim = { kind: 'terms', id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 3, other: true };
const sev = { field: 'SeverityNumber', fieldLabel: 'SeverityNumber', numeric: true };
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const cumsum: MetricDim = { kind: 'metric', id: 'm0', op: 'cumulative_sum', ref: { op: 'count' } };
const diffs: MetricDim = { kind: 'metric', id: 'm0', op: 'differences', ref: { op: 'count' } };
const movAvg: MetricDim = { kind: 'metric', id: 'm1', op: 'moving_average', window: 2, ref: { op: 'median', ...sev } };
const rate: MetricDim = { kind: 'metric', id: 'm2', op: 'counter_rate', ...sev };
const std: MetricDim = { kind: 'metric', id: 'm3', op: 'std_dev', ...sev };
const last: MetricDim = { kind: 'metric', id: 'm4', op: 'last_value', ...sev };
const pctOfTotal: MetricDim = {
  kind: 'metric',
  id: 'm0',
  op: 'formula',
  formula: 'count() / overall_sum(count())',
  formulaFields: {},
};
const line = (buckets: BucketDim[], metrics: MetricDim[]): LensState => ({ chartType: 'line', buckets, metrics });
const sqlOf = (s: LensState, mode: 'app' | 'dashboard' = 'app') => compileLens(s, config, conds, range, mode).sql;

describe('labels (Kibana wording)', () => {
  it('names each function and its inner metric', () => {
    expect(autoLabelIn(std)).toBe('Standard deviation of SeverityNumber');
    expect(autoLabelIn(last)).toBe('Last value of SeverityNumber');
    expect(autoLabelIn(cumsum)).toBe('Cumulative sum of Count of records');
    expect(autoLabelIn(diffs)).toBe('Differences of Count of records');
    expect(autoLabelIn(movAvg)).toBe('Moving average of Median of SeverityNumber');
    expect(autoLabelIn({ ...movAvg, ref: { op: 'percentile', ...sev, percentile: 99 } })).toBe(
      'Moving average of 99th percentile of SeverityNumber'
    );
    // Counter rate is always per unit of time.
    expect(autoLabelIn(rate)).toBe('Counter rate of SeverityNumber per second');
    expect(autoLabelIn({ ...rate, normalize: 'm' })).toBe('Counter rate of SeverityNumber per minute');
    expect(autoLabelIn({ ...cumsum, shift: '1d' })).toBe('Cumulative sum of Count of records (1d ago)');
  });

  it('a top values rank names only a rankable metric', () => {
    const t: TermsDim = { ...svc, rankBy: 'metric', rankMetric: 'm1' };
    expect(autoLabelIn(t, [movAvg])).toBe('Top 3 values of ServiceName');
    expect(autoLabelIn(t, [{ ...cumsum, id: 'm1' }])).toBe(
      'Top 3 values of ServiceName by Cumulative sum of Count of records'
    );
  });
});

describe('URL sanitizing', () => {
  const round = (m: unknown) => decodeLens(JSON.stringify({ chartType: 'line', buckets: [date], metrics: [m] }));

  it('keeps well-formed calculations and normalizes the window', () => {
    expect(round(movAvg)?.metrics[0]).toEqual({ ...movAvg, name: undefined });
    expect(round({ ...movAvg, window: 1e9 })?.metrics[0].window).toBe(100);
    expect(round({ ...movAvg, window: '5); DROP TABLE x' })?.metrics[0].window).toBe(5);
    expect(round({ ...movAvg, window: undefined })?.metrics[0].window).toBe(5);
    expect(round({ ...movAvg, ref: { op: 'percentile', ...sev, percentile: 1000 } })?.metrics[0].ref?.percentile).toBe(
      99
    );
    expect(round(std)?.metrics[0]).toMatchObject({ op: 'std_dev', field: 'SeverityNumber', numeric: true });
    expect(round(rate)?.metrics[0]).toMatchObject({ op: 'counter_rate', field: 'SeverityNumber' });
  });

  it('drops calculations whose inner metric is malformed', () => {
    expect(round({ ...cumsum, ref: undefined })?.metrics).toEqual([]);
    expect(round({ ...cumsum, ref: { op: 'avg', ...sev } })?.metrics).toEqual([]); // running totals add counts / sums only
    expect(round({ ...diffs, ref: { op: 'formula', formula: 'count()' } })?.metrics).toEqual([]);
    expect(round({ ...diffs, ref: { op: 'sum', field: 42 } })?.metrics).toEqual([]);
    expect(round({ ...diffs, ref: { op: 'cumulative_sum' } })?.metrics).toEqual([]); // no nesting
    // Extra keys never ride along.
    const m = round({ ...movAvg, ref: { ...movAvg.ref, sql: '1; DROP' }, evil: 1 })?.metrics[0] as unknown as Record<
      string,
      unknown
    >;
    expect(m.evil).toBeUndefined();
    expect((m.ref as Record<string, unknown>).sql).toBeUndefined();
  });

  it("an inner metric's field must be a discovered field", () => {
    const s = line([date], [{ ...diffs, ref: { op: 'sum', field: 'x) FROM system.users --', numeric: true } }, count]);
    expect(sanitizeLens(s, new Set(['Timestamp', 'SeverityNumber'])).metrics).toEqual([count]);
    const ok = line([date], [movAvg]);
    expect(sanitizeLens(ok, new Set(['Timestamp', 'SeverityNumber']))).toBe(ok);
  });

  it('round-trips through encodeLens', () => {
    const s = line([date, svc], [cumsum, { ...movAvg, id: 'm1' }, rate, std, last]);
    expect(decodeLens(encodeLens(s))?.metrics.map((m) => m.op)).toEqual([
      'cumulative_sum',
      'moving_average',
      'counter_rate',
      'std_dev',
      'last_value',
    ]);
  });
});

describe('SQL', () => {
  it('Standard deviation and Last value are plain aggregates (no wrapping)', () => {
    const sql = sqlOf(line([date], [std, last]));
    expect(sql).toContain('stddevPopOrNull("SeverityNumber") AS m0');
    expect(sql).toContain('argMaxIfOrNull("SeverityNumber", Timestamp, "SeverityNumber" IS NOT NULL) AS m1');
    expect(sql).not.toContain('OVER');
    // Filter by → the conditional form.
    const f = sqlOf(line([date], [{ ...last, filter: 'ServiceName : payments' }]));
    expect(f).toMatch(
      /argMaxIfOrNull\("SeverityNumber", Timestamp, "SeverityNumber" IS NOT NULL AND \(.*payments.*\)\) AS m0/
    );
  });

  it('a calculation wraps the grouped query: gap-filled inner, window functions outside (app)', () => {
    expect(sqlOf(line([date, svc], [cumsum]))).toMatchSnapshot();
  });

  it('saved panels compute the same calculation over $__timeInterval buckets', () => {
    const sql = sqlOf(line([date, svc], [cumsum]), 'dashboard');
    expect(sql).toMatchSnapshot();
    expect(sql).toContain('ORDER BY b1, k1, b0 WITH FILL FROM toStartOfInterval($__fromTime');
    expect(sql).toContain('PARTITION BY b1, k1 ORDER BY b0 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW');
  });

  it('every function in one query; nullable inner aggregates use -OrNull so empty buckets stay empty', () => {
    const sql = sqlOf(line([date], [diffs, movAvg, rate, std, last]));
    expect(sql).toMatchSnapshot();
    expect(sql.match(/^SELECT/gm)).toHaveLength(2); // one outer, one inner — no second round trip
    expect(sql).toContain('quantileOrNull(0.5)("SeverityNumber") AS a1');
    expect(sql).toContain('maxOrNull("SeverityNumber") AS a2');
    // Counter rate per second of a 1-day bucket.
    expect(sql).toMatch(/\* 0\.0000115740740741 AS m2/);
  });

  it('Include empty rows off: no gap filling; not bound to the time picker: fill between data only', () => {
    expect(sqlOf(line([{ ...date, emptyRows: false } as BucketDim], [cumsum]))).not.toContain('WITH FILL');
    expect(sqlOf(line([{ ...date, unbound: true } as BucketDim], [cumsum]))).toContain(
      'ORDER BY __d WITH FILL STEP INTERVAL 1 DAY'
    );
  });

  it('calendar and millisecond buckets fill on DateTime / DateTime64', () => {
    const m = sqlOf(line([{ ...date, interval: '1M' } as BucketDim], [cumsum]));
    expect(m).toContain('toDateTime(toStartOfInterval("Timestamp", INTERVAL 1 MONTH)) AS __d');
    expect(m).toContain(
      'WITH FILL FROM toDateTime(toStartOfInterval($__fromTime, INTERVAL 1 MONTH)) TO $__toTime STEP INTERVAL 1 MONTH'
    );
    expect(m).toContain('toUnixTimestamp(__d) * 1000 AS b0');
    const shortRange = { from, to: dateTime(T0 + 60_000), raw: { from, to: dateTime(T0 + 60_000) } };
    const ms = compileLens(
      line([{ ...date, interval: '500ms' } as BucketDim], [cumsum]),
      config,
      conds,
      shortRange
    ).sql;
    expect(ms).toContain('toStartOfInterval(toDateTime64("Timestamp", 3), INTERVAL 500 MILLISECOND) AS __d');
    expect(ms).toContain('STEP toIntervalMillisecond(500)');
    expect(ms).toContain('toUnixTimestamp64Milli(__d) AS b0');
  });

  it('Drop partial intervals runs before the window (a running total starts at the first whole bucket)', () => {
    const sql = sqlOf(line([{ ...date, dropPartial: true } as BucketDim], [cumsum]));
    expect(sql).toContain(')\nWHERE __d >= $__fromTime AND __d + INTERVAL 1 DAY <= $__toTime');
  });

  it('time shift and Filter by apply to the inner metric', () => {
    const sql = sqlOf(line([date], [count, { ...cumsum, id: 'm1', shift: '1d', filter: 'ServiceName : payments' }]));
    expect(sql).toContain('ARRAY JOIN [0, 1] AS __s');
    expect(sql).toMatch(/countIf\(__s = 1 AND \(.*payments.*\)\) AS a1/);
    expect(sql).toContain('countIf(__s = 0) AS a0');
  });

  it('normalize by unit applies after the calculation', () => {
    const sql = sqlOf(line([date], [{ ...diffs, normalize: 'h' }]));
    expect(sql).toMatch(/\(\(a0 - lagInFrame\(toNullable\(a0\), 1, NULL\).*\)\) \* 0\.0416666666667 AS m0/);
  });

  it('no date histogram: the calculation compiles to no value (the page shows why instead)', () => {
    const sql = sqlOf({ chartType: 'table', buckets: [svc], metrics: [cumsum] });
    expect(sql).toContain('NULL AS m0');
    expect(calculationError({ buckets: [svc], metrics: [cumsum] })).toBe(
      'Cumulative sum of Count of records needs a date histogram dimension. Add a date histogram, or choose a function that is not a calculation.'
    );
    expect(calculationError({ buckets: [date], metrics: [cumsum] })).toBeNull();
    expect(calculationError({ buckets: [svc], metrics: [pctOfTotal] })).toBeNull(); // overall_* needs none
    expect(calculationError({ buckets: [], metrics: [{ ...pctOfTotal, formula: 'differences(count())' }] })).toMatch(
      /^The formula uses differences, which needs a date histogram/
    );
  });

  it('top values cannot rank by a calculation except Cumulative sum (ranked by its inner metric)', () => {
    expect(isRankable(cumsum)).toBe(true);
    expect(isRankable(movAvg)).toBe(false);
    expect(isRankable(pctOfTotal)).toBe(false);
    expect(isRankable(std)).toBe(true);
    const bySum: MetricDim = { ...cumsum, ref: { op: 'sum', ...sev } };
    const ranked = sqlOf({
      chartType: 'bar',
      buckets: [{ ...svc, rankBy: 'metric', rankMetric: 'm0' }, date],
      metrics: [bySum],
    });
    expect(ranked).toContain('ORDER BY sum("SeverityNumber") DESC, v LIMIT 3');
    expect(ranked).toContain('ORDER BY k0, m0 DESC');
    const fallback = sqlOf({
      chartType: 'bar',
      buckets: [{ ...svc, rankBy: 'metric', rankMetric: 'm1' }, date],
      metrics: [count, movAvg],
    });
    expect(fallback).toContain('GROUP BY v ORDER BY count() DESC LIMIT 3');
  });

  it('percent of total: overall over everything without a date histogram, per series with one', () => {
    const pie = sqlOf({ chartType: 'pie', buckets: [svc], metrics: [pctOfTotal] });
    expect(pie).toContain('(a0 / nullIf(sum(a0) OVER (), 0)) AS m0');
    const series = sqlOf(line([date, svc], [pctOfTotal]));
    expect(series).toContain('(a0 / nullIf(sum(a0) OVER (PARTITION BY b1, k1), 0)) AS m0');
  });

  it('the window SQL builders print only aliases and clamped numbers', () => {
    expect(cumulativeSumSql('a0', 'ORDER BY __d')).toBe(
      'sum(ifNull(a0, 0)) OVER (ORDER BY __d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)'
    );
    expect(differencesSql('a0', 'ORDER BY __d')).toBe(
      '(a0 - lagInFrame(toNullable(a0), 1, NULL) OVER (ORDER BY __d ROWS BETWEEN 1 PRECEDING AND CURRENT ROW))'
    );
    expect(movingAverageSql('a0', 'ORDER BY __d', 1e6)).toContain('-100)');
    expect(movingAverageSql('a0', 'ORDER BY __d', NaN)).toContain('-5)');
    expect(counterRateSql('a0', 'ORDER BY __d')).toMatch(/^multiIf\(lagInFrame.* IS NULL, NULL, a0 >= lagInFrame/);
    expect(clampWindow('3')).toBe(3);
    expect(clampWindow(0)).toBe(1);
  });
});

describe('numbers (fixture)', () => {
  // Rows of `line([date], [diffs, movAvg, rate, std, last])` on ClickHouse (see the file header).
  const rows = [
    { b0: T0, m0: null, m1: null, m2: null, m3: 2.6224690179294776, m4: 9 },
    { b0: T0 + DAY, m0: 0, m1: 9, m2: 0, m3: 2.5516742869470357, m4: 13 },
    { b0: T0 + 2 * DAY, m0: 0, m1: 9, m2: 0, m3: 2.645154841555116, m4: 9 },
    { b0: T0 + 3 * DAY, m0: 0, m1: 9, m2: 0, m3: 2.629999281204427, m4: 9 },
    // The payments incident (1,200 extra rows on 2026-01-05) shows up as +1200 / −1200.
    { b0: T0 + 4 * DAY, m0: 1200, m1: 9, m2: 0, m3: 3.660474313856681, m4: 9 },
    { b0: T0 + 5 * DAY, m0: -1200, m1: 9, m2: 0, m3: 2.604065183207797, m4: 9 },
    { b0: T0 + 6 * DAY, m0: 0, m1: 9, m2: 0, m3: 2.5912102692993146, m4: 9 },
  ];
  const s = line([date], [diffs, movAvg, rate, std, last]);
  const res = shapeLensRows(s, rows, DAY, { interval: { n: 1, unit: 'd' }, range: { from: T0, to: T0 + 7 * DAY } });

  it('the first bucket has no difference / moving average / rate: a gap, not 0', () => {
    const [d, ma, cr] = res.series;
    expect(d.points.has(T0)).toBe(false);
    expect(d.points.get(T0 + 4 * DAY)).toBe(1200);
    expect(d.points.get(T0 + 5 * DAY)).toBe(-1200);
    expect(ma.points.has(T0)).toBe(false);
    expect(ma.points.get(T0 + DAY)).toBe(9);
    expect(cr.points.get(T0 + DAY)).toBe(0);
    expect(res.series.every((x) => !x.zeroFill)).toBe(true);
    expect(res.table.rows[0].slice(1)).toEqual([null, null, null, 2.6224690179294776, 9]);
  });

  it('cumulative count per service ends at each service total (fixture: payments 9,264, others 8,064)', () => {
    const cum = shapeLensRows(
      line([date, svc], [cumsum]),
      [
        { b0: T0, k1: 0, b1: 'payments', m0: 1152 },
        { b0: T0 + 4 * DAY, k1: 0, b1: 'payments', m0: 6960 },
        { b0: T0 + 6 * DAY, k1: 0, b1: 'payments', m0: 9264 },
        { b0: T0 + 6 * DAY, k1: 0, b1: 'checkout', m0: 8064 },
        { b0: T0 + 6 * DAY, k1: 1, b1: '', m0: 16128 },
      ],
      DAY,
      { interval: { n: 1, unit: 'd' }, range: { from: T0, to: T0 + 7 * DAY } }
    );
    expect(cum.series.map((x) => [x.name, x.points.get(T0 + 6 * DAY)])).toEqual([
      ['payments', 9264],
      ['checkout', 8064],
      ['Other', 16128],
    ]);
    // A running total never reads a bucket the query did not return as 0.
    expect(cum.series[1].points.has(T0)).toBe(false);
  });
});

describe('formula', () => {
  const fields = { SeverityNumber: { expr: 'SeverityNumber', numeric: true }, Body: { expr: 'Body', numeric: false } };
  const errs = (f: string) => formulaErrors(f, fields).map((e) => e.message);

  it('accepts the new functions', () => {
    for (const f of [
      'standard_deviation(SeverityNumber)',
      'last_value(SeverityNumber)',
      'cumulative_sum(count())',
      'differences(sum(SeverityNumber))',
      'moving_average(count(), window=10)',
      'counter_rate(max(SeverityNumber))',
      'count() / overall_sum(count())',
      'sum(SeverityNumber) - overall_average(sum(SeverityNumber))',
      '(sum(SeverityNumber) - overall_min(sum(SeverityNumber))) / (overall_max(sum(SeverityNumber)) - overall_min(sum(SeverityNumber)))',
      'cumulative_sum(count() * 2)',
    ]) {
      expect([f, errs(f)]).toEqual([f, []]);
    }
  });

  it('rejects misuse with a clear message', () => {
    expect(errs('cumulative_sum(differences(count()))')).toEqual(['differences cannot be used inside cumulative_sum']);
    expect(errs('sum(cumulative_sum(count()))')[0]).toMatch(/must be a field|cannot be used inside an aggregation/);
    expect(errs('cumulative_sum(5)')).toEqual(['cumulative_sum needs a metric, e.g. cumulative_sum(count())']);
    expect(errs('moving_average(count(), window=0)')).toEqual(['window must be a whole number from 1 to 100']);
    expect(errs('moving_average(count(), window=101)')).toEqual(['window must be a whole number from 1 to 100']);
    expect(errs('moving_average(count(), window=2.5)')).toEqual(['window must be a whole number from 1 to 100']);
    expect(errs("moving_average(count(), window='5')")).toEqual(['window must be a number']);
    expect(errs('standard_deviation(Body)')).toEqual(['standard_deviation needs a number field; Body is not a number']);
    expect(errs('overall_sum(count(), 2)')).toEqual(['overall_sum expects 1 argument']);
  });

  it('knows which functions need a date histogram', () => {
    expect(formulaUsesWindow('count() / overall_sum(count())')).toBe(true);
    expect(formulaUsesWindow('count() / 2')).toBe(false);
    expect(formulaTimeSeriesFns('count() / overall_sum(count())')).toEqual([]);
    expect(formulaTimeSeriesFns('cumulative_sum(count()) + differences(count())')).toEqual([
      'cumulative_sum',
      'differences',
    ]);
    expect(formulaTimeSeriesFns('not a (formula')).toEqual([]);
  });

  it('compiles aggregates to inner columns and the rest to window SQL', () => {
    const inner: string[] = [];
    const sql = formulaToSql('moving_average(average(SeverityNumber), window=3) / overall_max(count())', fields, {
      config,
      window: {
        series: 'ORDER BY __d',
        overall: '',
        inner: (s) => {
          inner.push(s);
          return `a${inner.length - 1}`;
        },
      },
    });
    expect(inner).toEqual(['avgOrNull("SeverityNumber")', 'count()']);
    expect(sql).toBe(
      "(if(isNull(a0), NULL, arrayReduce('avgOrNull', arraySlice(groupArray(a0) OVER (ORDER BY __d ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), -3))) / nullIf(max(a1) OVER (), 0))"
    );
    // Without window mode (never the case for a compiled chart) a window function has no SQL.
    expect(formulaToSql('cumulative_sum(count())', fields, { config })).toBeNull();
  });

  it('a quick calculation converts to the same formula', () => {
    const lf: LensField[] = [
      { id: 'SeverityNumber', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
    ];
    expect(toFormula(movAvg, lf).formula).toBe('moving_average(median(SeverityNumber), window=2)');
    expect(toFormula(cumsum, lf).formula).toBe('cumulative_sum(count())');
    expect(toFormula(std, lf).formula).toBe('standard_deviation(SeverityNumber)');
    const cr = toFormula(rate, lf);
    expect(cr.formula).toBe('counter_rate(max(SeverityNumber))');
    expect(cr.normalize).toBe('s'); // the formula's counter_rate is per bucket: keep per second
  });
});

describe('switching functions', () => {
  const lf: LensField[] = [
    { id: 'SeverityNumber', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
    { id: 'ServiceName', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
  ];
  const median: MetricDim = { kind: 'metric', id: 'm9', op: 'median', ...sev, name: 'n', filter: 'a : b' };

  it('the metric so far becomes what is calculated on', () => {
    expect(withOp(median, 'moving_average', lf)).toEqual({
      kind: 'metric',
      id: 'm9',
      op: 'moving_average',
      ref: { op: 'median', ...sev },
      window: 5,
      name: 'n',
      filter: 'a : b',
    });
    // A running total of a median is meaningless: the sum of the same field instead.
    expect(withOp(median, 'cumulative_sum', lf)?.ref).toEqual({ op: 'sum', ...sev });
    expect(
      withOp({ ...median, op: 'unique', field: 'ServiceName', numeric: false }, 'cumulative_sum', lf)?.ref
    ).toEqual({
      op: 'count',
    });
    expect(withOp(median, 'counter_rate', lf)).toMatchObject({ op: 'counter_rate', field: 'SeverityNumber' });
  });

  it('leaving a calculation keeps its inner field', () => {
    expect(withOp(movAvg, 'max', lf)).toMatchObject({ op: 'max', field: 'SeverityNumber' });
    expect(withOp(rate, 'differences', lf)?.ref).toEqual({ op: 'max', ...sev });
    expect(withRefOp(movAvg, 'unique', lf)?.ref).toEqual({ op: 'unique', ...sev });
    expect(withRefOp(movAvg, 'count', lf)?.ref).toEqual({ op: 'count' });
    expect(withWindow(movAvg, 500).window).toBe(100);
  });
});

describe('editor', () => {
  // Grafana's Combobox measures text on a canvas, which jsdom does not implement.
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  const lf: LensField[] = [
    { id: 'SeverityNumber', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
  ];
  function Harness({ start, chart }: { start: MetricDim; chart: LensState }) {
    const [d, setD] = useState<MetricDim>(start);
    return (
      <>
        <DimensionEditor
          dim={d}
          group="Vertical axis"
          fields={lf}
          chart={{ ...chart, metrics: [d] }}
          metrics={[d]}
          timeField="Timestamp"
          onChange={(x) => setD(x as MetricDim)}
          onRemove={() => {}}
          onClose={() => {}}
        />
        <pre data-testid="out">{JSON.stringify(d)}</pre>
      </>
    );
  }
  const out = () => JSON.parse(screen.getByTestId('out').textContent!);

  it('without a date histogram the Calculations are disabled and say why', () => {
    render(<Harness start={count} chart={{ chartType: 'table', buckets: [svc], metrics: [] }} />);
    const group = screen.getByRole('group', { name: 'Calculations' });
    for (const name of ['Counter rate', 'Cumulative sum', 'Differences', 'Moving average']) {
      expect(within(group).getByRole('button', { name })).toBeDisabled();
    }
    expect(group).toHaveAccessibleDescription('Calculations need a date histogram dimension. Add one to use them.');
    expect(screen.getByRole('group', { name: 'Quick function' })).toBeInTheDocument();
    expect(
      within(screen.getByRole('group', { name: 'Quick function' })).getByRole('button', { name: 'Standard deviation' })
    ).toBeEnabled();
  });

  it('Moving average: wraps the current metric, explains itself, window 1–100', () => {
    render(<Harness start={count} chart={line([date], [])} />);
    fireEvent.click(screen.getByRole('button', { name: 'Moving average' }));
    expect(out()).toMatchObject({ op: 'moving_average', ref: { op: 'count' }, window: 5 });
    expect(screen.getByRole('note', { name: 'About this function' })).toHaveTextContent(
      'the current bucket is not included'
    );
    const w = screen.getByLabelText('Window size');
    fireEvent.change(w, { target: { value: '250' } });
    fireEvent.blur(w);
    expect(out().window).toBe(100);
    expect(screen.getByLabelText('Calculated on')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Moving average of Count of records')).toBeInTheDocument();
  });

  it('a saved panel carries the calculation SQL', () => {
    const panel = buildLensPanel(line([date, svc], [cumsum]), config, conds, range, {
      id: 1,
      gridPos: { x: 0, y: 0, w: 12, h: 8 },
    });
    const sql = (panel.targets?.[0] as { rawSql: string }).rawSql;
    expect(sql).toContain('sum(ifNull(a0, 0)) OVER (PARTITION BY b1, k1 ORDER BY b0');
    expect(panel.title).toBeDefined();
  });
});
