import { dateTime } from '@grafana/data';
import { fetchNewestFirst, isNewestFirstSort, narrowTimeRange, planWindows } from '../windowedSearch';

const H = 3_600_000;
const DAY = 24 * H;

// Fake table: one row per `gapMs`, every `matchEvery`-th one matches the filter, newest first.
function fakeRunner(gapMs: number, matchEvery: number) {
  const calls: Array<{ fromMs: number; toMs: number }> = [];
  const all = (fromMs: number, to: number) => {
    const rows: number[] = [];
    for (let t = Math.floor(to / gapMs) * gapMs, i = 0; t >= fromMs; t -= gapMs, i++) {
      if (i % matchEvery === 0) {
        rows.push(t);
      }
    }
    return rows;
  };
  const makeRun = (limit: number, offset = 0) => async (r: { fromMs: number; toMs: number }) => {
    calls.push(r);
    return all(r.fromMs, r.toMs).slice(offset, offset + limit);
  };
  return { calls, makeRun, all };
}

describe('planWindows', () => {
  it('grows geometrically and ends with the full span', () => {
    expect(planWindows(7 * DAY)).toEqual([H, 6 * H, 36 * H, 7 * DAY]);
  });
  it('caps the number of steps', () => {
    expect(planWindows(100 * DAY, { maxSteps: 2 })).toEqual([H, 100 * DAY]);
    expect(planWindows(100 * DAY, { maxSteps: 1 })).toEqual([100 * DAY]);
  });
  it('collapses windows that are at least half the span', () => {
    expect(planWindows(3 * H)).toEqual([H, 3 * H]);
    expect(planWindows(H)).toEqual([H]);
  });
});

describe('fetchNewestFirst', () => {
  const to = 1_800_000_000_000;
  const from = to - 7 * DAY;

  it('stops at the first window that fills the page', async () => {
    const f = fakeRunner(60_000, 1);
    const res = await fetchNewestFirst({ fromMs: from, toMs: to, limit: 50, run: f.makeRun(50) });
    expect(res.steps).toBe(1);
    expect(f.calls).toEqual([{ fromMs: to - H, toMs: to }]);
    expect(res.rows).toEqual(f.all(from, to).slice(0, 50));
  });

  it('widens until full and returns the same rows as the full query', async () => {
    const f = fakeRunner(60_000, 10); // one match per 10 min
    const res = await fetchNewestFirst({ fromMs: from, toMs: to, limit: 200, run: f.makeRun(200) });
    expect(res.steps).toBe(3);
    expect(f.calls.map((c) => to - c.fromMs)).toEqual([H, 6 * H, 36 * H]);
    expect(res.rows).toEqual(f.all(from, to).slice(0, 200));
    expect(res.windowMs).toBe(36 * H);
  });

  it('falls back to the full range, returning every row when fewer than limit exist', async () => {
    const f = fakeRunner(60_000, 600); // very sparse
    const res = await fetchNewestFirst({ fromMs: from, toMs: to, limit: 200, run: f.makeRun(200) });
    expect(res.steps).toBe(4);
    expect(f.calls[3]).toEqual({ fromMs: from, toMs: to });
    expect(res.rows).toEqual(f.all(from, to));
  });

  it('keeps OFFSET semantics: pages equal the full query slice', async () => {
    const f = fakeRunner(60_000, 30);
    const full = f.all(from, to);
    const res = await fetchNewestFirst({ fromMs: from, toMs: to, limit: 100, run: f.makeRun(100, 200) });
    expect(res.rows).toEqual(full.slice(200, 300));
  });

  it('issues a single plain query for short ranges', async () => {
    const f = fakeRunner(60_000, 1);
    const res = await fetchNewestFirst({ fromMs: to - 30 * 60_000, toMs: to, limit: 1000, run: f.makeRun(1000) });
    expect(res.steps).toBe(1);
    expect(f.calls).toEqual([{ fromMs: to - 30 * 60_000, toMs: to }]);
  });

  it('is cancellable', async () => {
    const ac = new AbortController();
    const run = jest.fn(async () => {
      ac.abort();
      return [];
    });
    await expect(fetchNewestFirst({ fromMs: from, toMs: to, limit: 10, run, signal: ac.signal })).rejects.toThrow(/abort/i);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('isNewestFirstSort', () => {
  const config = { columns: { timestamp: 'Timestamp' } } as never;
  it('is true for default and time-desc, false otherwise', () => {
    expect(isNewestFirstSort(config, {})).toBe(true);
    expect(isNewestFirstSort(config, { sort: { col: '__timestamp', dir: 'desc' } })).toBe(true);
    expect(isNewestFirstSort(config, { sort: { col: '__timestamp', dir: 'asc' } })).toBe(false);
    expect(isNewestFirstSort(config, { sort: { col: 'SeverityText', dir: 'desc' } })).toBe(false);
    expect(isNewestFirstSort(config, { useRawSql: true })).toBe(false);
    expect(isNewestFirstSort({ columns: {} } as never, {})).toBe(false);
  });
});

describe('narrowTimeRange', () => {
  const range = { from: dateTime(1000), to: dateTime(9000), raw: { from: 'now-1h', to: 'now' } } as never;
  it('narrows from, keeps to', () => {
    const r = narrowTimeRange(range, 5000);
    expect(r.from.valueOf()).toBe(5000);
    expect(r.to.valueOf()).toBe(9000);
  });
  it('returns the range untouched when not narrower', () => {
    expect(narrowTimeRange(range, 500)).toBe(range);
  });
});
