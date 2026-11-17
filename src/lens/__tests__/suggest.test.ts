import { addField, suggestions, switchChart } from '../suggest';
import { dimLabel, EMPTY_LENS, LensField, LensState, RECORDS_FIELD } from '../state';

// Fixtures from the spec's LENS-AUTO-01 table (docs/spec/20-lens.md), on OTel fields.
const ctx = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };
const f = (sqlExpr: string, type: LensField['type']): LensField => ({ id: `col:${sqlExpr}`, sqlExpr, label: sqlExpr, type });
const TS = f('Timestamp', 'time');
const DURATION = f('SeverityNumber', 'number');
const LEVEL = f('SeverityText', 'string');
const SERVICE = f('ServiceName', 'string');

const add = (...fields: LensField[]) => fields.reduce<LensState>((s, x) => addField(s, x, ctx), EMPTY_LENS);
const shape = (s: LensState) => ({
  chart: s.chartType,
  x: s.buckets[0] ? dimLabel(s.buckets[0]) : undefined,
  breakdown: s.buckets[1] ? dimLabel(s.buckets[1]) : undefined,
  y: s.metrics.map(dimLabel),
});

describe('LENS-AUTO-01 automatic chart selection', () => {
  it.each([
    ['Records', [RECORDS_FIELD], { chart: 'line', x: 'Timestamp', breakdown: undefined, y: ['Count of records'] }],
    ['@timestamp', [TS], { chart: 'line', x: 'Timestamp', breakdown: undefined, y: ['Count of records'] }],
    ['number field', [DURATION], { chart: 'line', x: 'Timestamp', breakdown: undefined, y: ['Median of SeverityNumber'] }],
    ['keyword', [LEVEL], { chart: 'bar', x: 'Top 9 values of SeverityText', breakdown: undefined, y: ['Count of records'] }],
    [
      '@timestamp then keyword',
      [TS, SERVICE],
      { chart: 'line', x: 'Timestamp', breakdown: 'Top 9 values of ServiceName', y: ['Count of records'] },
    ],
    [
      'keyword then keyword',
      [LEVEL, SERVICE],
      { chart: 'bar', x: 'Top 9 values of SeverityText', breakdown: 'Top 9 values of ServiceName', y: ['Count of records'] },
    ],
    ['@timestamp then number', [TS, DURATION], { chart: 'line', x: 'Timestamp', breakdown: undefined, y: ['Count of records', 'Median of SeverityNumber'] }],
    [
      'keyword then number',
      [SERVICE, DURATION],
      { chart: 'bar', x: 'Top 9 values of ServiceName', breakdown: undefined, y: ['Count of records', 'Median of SeverityNumber'] },
    ],
  ])('%s', (_name, fields, expected) => {
    expect(shape(add(...fields))).toEqual(expected);
  });

  it('bars are stacked by default; whole Map/JSON containers are not addable', () => {
    expect(add(LEVEL).subType).toBe('stacked');
    expect(add(f('LogAttributes', 'map'))).toEqual(EMPTY_LENS);
  });

  it('without a time field a metric stays a single number', () => {
    expect(addField(EMPTY_LENS, RECORDS_FIELD, {}).chartType).toBe('metric');
  });
});

describe('LENS-TYPE-01 dimension remapping', () => {
  const bar = add(SERVICE, LEVEL);

  it('Bar → Table keeps both buckets as rows and the metric', () => {
    expect(shape(switchChart(bar, 'table', ctx))).toEqual({
      chart: 'table',
      x: 'Top 9 values of ServiceName',
      breakdown: 'Top 9 values of SeverityText',
      y: ['Count of records'],
    });
  });

  it('Table → Metric keeps the first bucket as "break down by" and drops the second', () => {
    const metric = switchChart(switchChart(bar, 'table', ctx), 'metric', ctx);
    expect(shape(metric)).toEqual({ chart: 'metric', x: 'Top 9 values of ServiceName', breakdown: undefined, y: ['Count of records'] });
  });

  it('histogram → Metric is one big number; Metric → Line adds the date histogram back', () => {
    const metric = switchChart(add(RECORDS_FIELD), 'metric', ctx);
    expect(shape(metric)).toEqual({ chart: 'metric', x: undefined, breakdown: undefined, y: ['Count of records'] });
    expect(shape(switchChart(metric, 'line', ctx)).x).toBe('Timestamp');
  });

  it('keeps dimension ids (labels/format survive) and never clears the layer', () => {
    const table = switchChart(bar, 'table', ctx);
    expect(table.buckets.map((b) => b.id)).toEqual(bar.buckets.map((b) => b.id));
    expect(switchChart({ chartType: 'table', buckets: [], metrics: [] }, 'pie', ctx).metrics).toHaveLength(1);
  });
});

describe('LENS-SUGG-01 suggestions', () => {
  it('histogram: current first, then Count of records (metric), Area stacked, Bar percentage', () => {
    const titles = suggestions(add(RECORDS_FIELD), ctx).map((s) => s.title);
    expect(titles[0]).toBe('Current visualization');
    expect(titles).toEqual(expect.arrayContaining(['Count of records', 'Area stacked', 'Bar percentage']));
  });

  it('two keywords: flip swaps X and breakdown', () => {
    const s = suggestions(add(LEVEL, SERVICE), ctx);
    const flip = s.find((x) => x.title === 'SeverityText for each ServiceName')!;
    expect(shape(flip.state)).toMatchObject({ x: 'Top 9 values of ServiceName', breakdown: 'Top 9 values of SeverityText' });
    expect(s.map((x) => x.title)).toEqual(expect.arrayContaining(['Pie', 'Table']));
  });

  it('one card per metric, no duplicate cards, none for an empty workspace', () => {
    const s = suggestions(add(SERVICE, DURATION), ctx);
    expect(s.map((x) => x.title)).toEqual(expect.arrayContaining(['Count of records', 'Median of SeverityNumber']));
    expect(new Set(s.map((x) => JSON.stringify(x.state))).size).toBe(s.length);
    expect(suggestions(EMPTY_LENS, ctx)).toEqual([]);
  });
});
