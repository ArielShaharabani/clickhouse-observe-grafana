import { dateTime } from '@grafana/data';
import { shiftTimeRange, zoomOutTimeRange } from '../timeRangeNav';

describe('shift / zoom out (DISC-TIME-01)', () => {
  const range = (a: number, b: number) => ({ from: dateTime(a), to: dateTime(b), raw: { from: dateTime(a), to: dateTime(b) } });
  it('shifts by one window each way', () => {
    const s = shiftTimeRange(range(1000, 3000), -1);
    expect([s.from.valueOf(), s.to.valueOf()]).toEqual([-1000, 1000]);
    const n = shiftTimeRange(range(1000, 3000), 1);
    expect([n.from.valueOf(), n.to.valueOf()]).toEqual([3000, 5000]);
  });
  it('zoom out doubles the window around its midpoint', () => {
    const z = zoomOutTimeRange(range(1000, 3000));
    expect([z.from.valueOf(), z.to.valueOf()]).toEqual([0, 4000]);
  });
});
