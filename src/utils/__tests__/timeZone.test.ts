import { dateMath } from '@grafana/data';
import { timeTicks } from '../../lens/render/timeTicks';
import { timeTicks as histTicks } from '../../components/_histogramTicks';
import { formatTimestamp } from '../../components/LogsTable';
import {
  formatInZone,
  getTimeZoneSettings,
  isValidTimeZone,
  parseInZone,
  reresolveRange,
  resetTimeZoneStoreForTests,
  resolveRange,
  setFiscalYearStartMonth,
  setTimeZone,
  toServerTimeZone,
} from '../timeZone';

const KEY = 'clickhouse-observe.timeSettings';

beforeEach(() => {
  window.localStorage.clear();
  resetTimeZoneStoreForTests();
});

describe('time zone store (R6-TZ)', () => {
  it('defaults to the Grafana preference and fiscal month 0', () => {
    expect(getTimeZoneSettings()).toEqual({ timeZone: 'browser', fiscalYearStartMonth: 0 });
  });

  it('persists a pick and reads it back after a reload', () => {
    setTimeZone('Asia/Tokyo');
    setFiscalYearStartMonth(3);
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ timeZone: 'Asia/Tokyo', fiscalYearStartMonth: 3 });
    resetTimeZoneStoreForTests();
    expect(getTimeZoneSettings()).toEqual({ timeZone: 'Asia/Tokyo', fiscalYearStartMonth: 3 });
  });

  it('the picker\'s Default option ("") goes back to the Grafana preference', () => {
    setTimeZone('utc');
    expect(getTimeZoneSettings().timeZone).toBe('utc');
    setTimeZone('');
    expect(getTimeZoneSettings().timeZone).toBe('browser');
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it('ignores invalid zones and months, in input and in storage', () => {
    setTimeZone('Not/AZone');
    setTimeZone("UTC'; DROP TABLE x");
    setFiscalYearStartMonth(12);
    setFiscalYearStartMonth(1.5);
    expect(getTimeZoneSettings()).toEqual({ timeZone: 'browser', fiscalYearStartMonth: 0 });
    window.localStorage.setItem(KEY, JSON.stringify({ timeZone: "x'; --", fiscalYearStartMonth: '3' }));
    resetTimeZoneStoreForTests();
    expect(getTimeZoneSettings()).toEqual({ timeZone: 'browser', fiscalYearStartMonth: 0 });
    window.localStorage.setItem(KEY, '{not json');
    resetTimeZoneStoreForTests();
    expect(getTimeZoneSettings().timeZone).toBe('browser');
  });

  it('validates zones', () => {
    expect(isValidTimeZone('browser')).toBe(true);
    expect(isValidTimeZone('utc')).toBe(true);
    expect(isValidTimeZone('America/Argentina/Buenos_Aires')).toBe(true);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(5)).toBe(false);
    expect(isValidTimeZone('a'.repeat(80))).toBe(false);
    expect(toServerTimeZone('utc')).toBe('UTC');
    expect(toServerTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
    expect(toServerTimeZone("x'y")).toBeUndefined();
  });
});

describe('formatting in the chosen zone', () => {
  const ms = Date.UTC(2026, 0, 15, 23, 30, 0);

  it('formats an instant in the zone', () => {
    expect(formatInZone(ms, 'YYYY-MM-DD HH:mm', 'utc')).toBe('2026-01-15 23:30');
    expect(formatInZone(ms, 'YYYY-MM-DD HH:mm', 'Asia/Tokyo')).toBe('2026-01-16 08:30');
    expect(formatInZone(ms, 'YYYY-MM-DD HH:mm', 'America/New_York')).toBe('2026-01-15 18:30');
  });

  it('formatTimestamp (grid, drawer) follows the store', () => {
    setTimeZone('Asia/Tokyo');
    expect(formatTimestamp(ms)).toBe('2026-01-16 08:30:00.000');
    setTimeZone('America/New_York');
    expect(formatTimestamp(ms)).toBe('2026-01-15 18:30:00.000');
  });

  it('parses wall-clock text in the zone', () => {
    expect(parseInZone('2026-01-16 08:30', 'YYYY-MM-DD HH:mm', 'Asia/Tokyo').valueOf()).toBe(ms);
  });

  it('axis ticks land on midnight of the zone', () => {
    const t0 = Date.UTC(2026, 0, 1, 12);
    const t1 = Date.UTC(2026, 0, 8, 12);
    for (const ticks of [timeTicks(t0, t1, 10, 'Asia/Tokyo'), histTicks(t0, t1, 800, 'Asia/Tokyo')]) {
      expect(ticks.length).toBeGreaterThan(2);
      for (const tk of ticks) {
        const t = 't' in tk ? tk.t : tk.time;
        expect(formatInZone(t, 'HH:mm:ss', 'Asia/Tokyo')).toBe('00:00:00');
      }
    }
  });
});

describe('relative ranges resolve in the zone', () => {
  // Tokyo is UTC+9 all year: "today" starts at 15:00 UTC of the previous day.
  const now = Date.UTC(2026, 0, 15, 20, 0, 0); // 05:00 on Jan 16 in Tokyo
  let spy: jest.SpyInstance;
  beforeEach(() => {
    spy = jest.spyOn(Date, 'now').mockReturnValue(now);
  });
  afterEach(() => spy.mockRestore());

  it('now/d differs between zones', () => {
    const utc = resolveRange({ from: 'now/d', to: 'now/d' }, { timeZone: 'utc', fiscalYearStartMonth: 0 });
    const tokyo = resolveRange({ from: 'now/d', to: 'now/d' }, { timeZone: 'Asia/Tokyo', fiscalYearStartMonth: 0 });
    expect(utc.from.valueOf()).toBe(Date.UTC(2026, 0, 15));
    expect(tokyo.from.valueOf()).toBe(Date.UTC(2026, 0, 15, 15));
    expect(tokyo.to.valueOf() - tokyo.from.valueOf()).toBe(86_400_000 - 1);
  });

  it('a day across a DST change is 23 or 25 hours long', () => {
    const berlin = { timeZone: 'Europe/Berlin', fiscalYearStartMonth: 0 };
    spy.mockReturnValue(Date.UTC(2026, 2, 29, 12)); // spring forward on 2026-03-29
    const spring = resolveRange({ from: 'now/d', to: 'now/d' }, berlin);
    expect(spring.to.valueOf() - spring.from.valueOf() + 1).toBe(23 * 3600_000);
    spy.mockReturnValue(Date.UTC(2026, 9, 25, 12)); // fall back on 2026-10-25
    const fall = resolveRange({ from: 'now/d', to: 'now/d' }, berlin);
    expect(fall.to.valueOf() - fall.from.valueOf() + 1).toBe(25 * 3600_000);
  });

  it('fiscal ranges use the fiscal month', () => {
    const r = resolveRange({ from: 'now/fy', to: 'now/fy' }, { timeZone: 'utc', fiscalYearStartMonth: 3 });
    expect(r.from.valueOf()).toBe(Date.UTC(2025, 3, 1)); // fiscal year Apr 2025 - Mar 2026
  });

  it('reresolveRange moves a rounded relative range and leaves absolute ones alone', () => {
    const rel = resolveRange({ from: 'now/d', to: 'now/d' }, { timeZone: 'utc', fiscalYearStartMonth: 0 });
    const moved = reresolveRange(rel, { timeZone: 'Asia/Tokyo', fiscalYearStartMonth: 0 });
    expect(moved.from.valueOf()).toBe(Date.UTC(2026, 0, 15, 15));
    const abs = resolveRange({ from: rel.from, to: rel.to });
    expect(reresolveRange(abs, { timeZone: 'Asia/Tokyo', fiscalYearStartMonth: 0 })).toBe(abs);
  });

  it('the store feeds dateMath consumers (default range, shorthand)', () => {
    setTimeZone('Asia/Tokyo');
    const { timeZone, fiscalYearStartMonth } = getTimeZoneSettings();
    expect(dateMath.parse('now/d', false, timeZone, fiscalYearStartMonth)!.valueOf()).toBe(Date.UTC(2026, 0, 15, 15));
  });
});
