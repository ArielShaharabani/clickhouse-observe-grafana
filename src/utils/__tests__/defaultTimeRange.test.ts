import { cleanDefaultTimeRange, resolveDefaultTimeRange } from '../defaultTimeRange';

const LAST_HOUR = { from: 'now-1h', to: 'now' };

describe('default time range setting', () => {
  it('keeps relative and absolute ranges that parse', () => {
    expect(cleanDefaultTimeRange({ from: 'now-7d', to: 'now' })).toEqual({ from: 'now-7d', to: 'now' });
    expect(cleanDefaultTimeRange({ from: ' 2026-01-01T00:00:00Z ', to: '2026-01-08T00:00:00Z' })).toEqual({
      from: '2026-01-01T00:00:00Z',
      to: '2026-01-08T00:00:00Z',
    });
  });

  it('falls back to the last hour for missing, junk, inverted or oversize values', () => {
    for (const raw of [
      undefined,
      null,
      'now-1h',
      { from: 'now' },
      { from: 1, to: 2 },
      { from: 'yesterday-ish', to: 'now' },
      { from: 'now', to: 'now-1h' },
      { from: `now-1h${' '.repeat(80)}x`, to: 'now' },
      { from: "now-1h'); DROP TABLE t; --", to: 'now' },
    ]) {
      expect(cleanDefaultTimeRange(raw)).toEqual(LAST_HOUR);
    }
  });

  it('resolves to a TimeRange keeping the raw strings', () => {
    const r = resolveDefaultTimeRange({ from: '2026-01-01T00:00:00Z', to: '2026-01-08T00:00:00Z' });
    expect(r.from.valueOf()).toBe(Date.UTC(2026, 0, 1));
    expect(r.to.valueOf()).toBe(Date.UTC(2026, 0, 8));
    expect(r.raw).toEqual({ from: '2026-01-01T00:00:00Z', to: '2026-01-08T00:00:00Z' });
    expect(resolveDefaultTimeRange().raw).toEqual(LAST_HOUR);
  });
});
