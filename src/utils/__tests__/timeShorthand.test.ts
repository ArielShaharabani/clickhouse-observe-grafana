import { formatDurationBadge, parseTimeShorthand } from '../timeShorthand';

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
    for (const bad of ['', 'abc', '-0d', '-7x', '7d', 'td d', '-d', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(parseTimeShorthand(bad)).toBeNull();
    }
  });
});

describe('parseTimeShorthand edge cases', () => {
  it('rejects ranges that overflow to an invalid date', () => {
    expect(parseTimeShorthand('-99999999999999y')).toBeNull();
  });
  it('units: s/h/d/w/y case-insensitive, m vs M distinct', () => {
    expect(parseTimeShorthand('-7D')!.raw.from).toBe('now-7d');
    expect(parseTimeShorthand('-2H')!.raw.from).toBe('now-2h');
    expect(parseTimeShorthand('-1Y')!.raw.from).toBe('now-1y');
    expect(parseTimeShorthand('-1m')!.raw.from).toBe('now-1m');
    expect(parseTimeShorthand('-1M')!.raw.from).toBe('now-1M');
  });
});

describe('formatDurationBadge', () => {
  it.each([
    [17 * 3600000 + 21 * 60000, '~17h'],
    [7 * 86400000, '~7d'],
    [45 * 60000, '~45m'],
    [30000, '~30s'],
    [86399999, '~1d'],
    [36 * 3600000, '~36h'],
    [90 * 60000, '~90m'],
    [3600000, '~1h'],
    [2 * 3600000, '~2h'],
    [400 * 86400000, '~400d'],
    [365 * 86400000, '~1y'],
    [800 * 86400000, '~2y'],
  ])('%d ms -> %s', (ms, label) => expect(formatDurationBadge(ms)).toBe(label));
});
