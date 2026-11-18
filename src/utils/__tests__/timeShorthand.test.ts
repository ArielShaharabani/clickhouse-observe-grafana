import { dateTime } from '@grafana/data';
import { formatDurationBadge, parseTimeShorthand } from '../timeShorthand';
import { shiftTimeRange, zoomOutTimeRange } from '../timeRangeNav';

describe('parseTimeShorthand (DISC-TIME-01)', () => {
  it('parses relative shorthand as now-N<unit> .. now', () => {
    const r = parseTimeShorthand('-7d')!;
    expect(r.raw).toEqual({ from: 'now-7d', to: 'now' });
    expect(r.to.valueOf() - r.from.valueOf()).toBeGreaterThanOrEqual(7 * 86400000 - 1000);
    expect(parseTimeShorthand(' -15m ')!.raw.from).toBe('now-15m');
    expect(parseTimeShorthand('now-1h')!.raw.from).toBe('now-1h');
    expect(parseTimeShorthand('-1M')!.raw.from).toBe('now-1M');
  });

  it('parses td / yd as whole local days', () => {
    const td = parseTimeShorthand('td')!;
    expect(td.raw).toEqual({ from: 'now/d', to: 'now/d' });
    expect(td.to.valueOf() - td.from.valueOf()).toBeGreaterThan(23 * 3600000);
    const yd = parseTimeShorthand('YD')!;
    expect(yd.raw.from).toBe('now-1d/d');
    expect(yd.to.valueOf()).toBeLessThanOrEqual(td.from.valueOf() + 1);
  });

  it('parses this week / month / year', () => {
    expect(parseTimeShorthand('tw')!.raw.from).toBe('now/w');
    expect(parseTimeShorthand('tm')!.raw.from).toBe('now/M');
    expect(parseTimeShorthand('ty')!.raw.from).toBe('now/y');
  });

  it('rejects anything else', () => {
    for (const bad of ['', 'abc', '-0d', '-7x', '7d', 'td d', '-d']) {
      expect(parseTimeShorthand(bad)).toBeNull();
    }
  });
});

describe('formatDurationBadge', () => {
  it.each([
    [17 * 3600000 + 21 * 60000, '~17h'],
    [7 * 86400000, '~7d'],
    [45 * 60000, '~45m'],
    [30000, '~30s'],
    [86399999, '~1d'],
    [400 * 86400000, '~1y'],
  ])('%d ms -> %s', (ms, label) => expect(formatDurationBadge(ms)).toBe(label));
});

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
