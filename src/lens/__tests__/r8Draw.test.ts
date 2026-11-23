import { LensResult } from '../compile';
import { timeSlots } from '../render/XyChart';

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

import { gaugeSpec } from '../render/gaugeSpec';
import { metricTiles } from '../render/MetricTiles';

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

import { formatNumber } from '../../utils/axisNumber';
import { formatMetricValue } from '../render/MetricTiles';

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

import { truncateLabel } from '../render/labels';

describe('R8 draw: L4 ellipsis', () => {
  it('cuts with an ellipsis', () => {
    expect(truncateLabel('GET /api/v1/customers/123', 80).endsWith('…')).toBe(true);
    expect(truncateLabel('GET', 80)).toBe('GET');
  });
});
