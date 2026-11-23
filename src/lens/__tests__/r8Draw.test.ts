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
