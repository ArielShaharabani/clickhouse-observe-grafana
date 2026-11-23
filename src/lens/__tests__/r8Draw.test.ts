import { LensResult, uniqueMetricLabels } from '../compile';
import { nothingFinite, slotStarts, stackValues, timeSlots } from '../render/XyChart';
import { gaugeSpec } from '../render/gaugeSpec';
import { formatMetricValue, metricTiles } from '../render/MetricTiles';
import { truncateLabel } from '../render/labels';
import { formatNumber } from '../../utils/axisNumber';
const DAY = 86_400_000;
const res = (xs: number[]): LensResult => ({ xs, xIsTime: true, xLabels: xs.map(String), series: [] }) as unknown as LensResult;

describe('R8 draw: M1 bars at their true time', () => {
  it('places buckets after a gap in their own slot', () => {
    expect(timeSlots(res([0, DAY, 5 * DAY, 6 * DAY]), DAY, false)).toEqual([0, 1, 5, 6]);
  });
  it('is off without gaps, horizontal, or for month-size buckets', () => {
    expect(timeSlots(res([0, DAY, 2 * DAY]), DAY, false)).toBeNull();
    expect(timeSlots(res([0, 5 * DAY]), DAY, true)).toBeNull();
    expect(timeSlots(res([0, 90 * DAY]), 30 * DAY, false)).toBeNull();
  });
  it('tolerates DST hour shifts', () => {
    expect(timeSlots(res([0, DAY - 3_600_000, 4 * DAY]), DAY, false)).toEqual([0, 1, 4]);
  });
});


describe('R8 draw: L1 / L6 empty first value', () => {
  const result = {
    xs: ['', 'a'],
    xLabels: ['', 'a'],
    xSynthetic: [false, false],
    xIsTime: false,
    series: [{ name: 'Count', points: new Map<string | number, number>([['', 1], ['a', 2]]), metricIndex: 0, zeroFill: true }],
    table: { columns: [], rows: [] },
  } as unknown as LensResult;
  const state = { chartType: 'gauge', metrics: [{ id: 'm', op: 'count' }], buckets: [{ kind: 'terms', field: 'n' }] } as never;
  it('keeps names and calls an empty value (empty)', () => {
    expect(gaugeSpec(state, result).frames[0].fields.map((f) => f.name)).toEqual(['(empty)', 'a']);
    expect(metricTiles({ ...(state as object), chartType: 'metric' } as never, result).map((t) => t.title)).toEqual(['(empty)', 'a']);
  });
});


describe('R8 draw: L3 / L5 numbers', () => {
  it('keeps significant digits of small numbers', () => {
    expect(formatNumber(0.0003)).toBe('0.0003');
    expect(formatNumber(0.00061)).toBe('0.00061');
    expect(formatNumber(0.00034567)).toBe('0.00035');
    expect(formatNumber(71160)).toBe('71,160');
    expect(formatNumber(1.23456)).toBe('1.235');
    expect(formatNumber(0)).toBe('0');
  });
  it('tiles use the same text as other charts', () => {
    const m = { id: 'm', op: 'avg', format: { id: 'custom', pattern: '0,0' } } as never;
    expect(formatMetricValue(m, 71160)).toBe('71,160');
    expect(formatMetricValue({ id: 'm', op: 'count' } as never, 71160)).toBe('71,160');
    expect(formatMetricValue(undefined as never, 0.0003)).toBe('0.0003');
  });
});


describe('R8 draw: L4 ellipsis', () => {
  it('cuts with an ellipsis', () => {
    expect(truncateLabel('GET /api/v1/customers/123', 80).endsWith('…')).toBe(true);
    expect(truncateLabel('GET', 80)).toBe('GET');
  });
});


describe('R8 draw: M6 log scale', () => {
  const r = {
    xs: ['a'],
    xIsTime: false,
    xLabels: ['a'],
    series: [
      { name: 's1', points: new Map([['a', -186]]), metricIndex: 0, zeroFill: false },
      { name: 's2', points: new Map([['a', 5]]), metricIndex: 0, zeroFill: false },
    ],
  } as unknown as LensResult;
  it('does not draw values <= 0 on a log axis', () => {
    expect(stackValues(r, [true, true], 'none', true).spans.map((s) => s[0])).toEqual([null, [0, 5]]);
    expect(stackValues(r, [true, true], 'none').spans[0][0]).toEqual([0, -186]);
  });
});


describe('R8 draw: M9 nothing finite', () => {
  const mk = (v: number, zeroFill = false) =>
    ({ xs: [1], series: [{ name: 's', points: new Map([[1, v]]), zeroFill, metricIndex: 0 }] }) as unknown as LensResult;
  it('detects NaN / inf only', () => {
    expect(nothingFinite(mk(NaN))).toBe(true);
    expect(nothingFinite(mk(Infinity))).toBe(true);
    expect(nothingFinite(mk(3))).toBe(false);
  });
});


describe('R8 draw: L6 equal metric labels', () => {
  it('uses the filter to tell them apart', () => {
    const l = uniqueMetricLabels([
      { kind: 'metric', id: 'a', op: 'count' },
      { kind: 'metric', id: 'b', op: 'count', filter: 'level:error' },
      { kind: 'metric', id: 'c', op: 'count' },
    ] as never);
    expect(l).toEqual(['Count of records', 'Count of records (level:error)', 'Count of records (2)']);
  });
});

it('slot starts cover the gaps, so times and positions agree over the whole axis', () => {
  const H = 3_600_000;
  expect(slotStarts([0, H, 4 * H], [0, 1, 4])).toEqual([0, H, 2 * H, 3 * H, 4 * H]);
});
