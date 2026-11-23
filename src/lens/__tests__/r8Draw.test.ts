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
