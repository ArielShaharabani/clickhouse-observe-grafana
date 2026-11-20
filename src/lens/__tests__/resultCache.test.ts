import { ResultCache } from '../resultCache';

describe('ResultCache', () => {
  it('returns a stored value for the same key, misses for another SQL / range / datasource', () => {
    const c = new ResultCache<number>();
    const k = ResultCache.key('ds', 'SELECT 1', 1, 2);
    c.set(k, 7);
    expect(c.get(k)).toBe(7);
    expect(c.get(ResultCache.key('ds', 'SELECT 2', 1, 2))).toBeUndefined();
    expect(c.get(ResultCache.key('ds', 'SELECT 1', 1, 3))).toBeUndefined();
    expect(c.get(ResultCache.key('other', 'SELECT 1', 1, 2))).toBeUndefined();
  });

  it('expires after the TTL', () => {
    let t = 0;
    const c = new ResultCache<number>(8, 60_000, () => t);
    c.set('a', 1);
    t = 60_000;
    expect(c.get('a')).toBe(1);
    t = 60_001;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });

  it('evicts the least recently used entry beyond the size', () => {
    const c = new ResultCache<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a'); // a is now most recent
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });

  it('set overwrites (Refresh stores the fresh rows) and resets the age', () => {
    let t = 0;
    const c = new ResultCache<number>(8, 100, () => t);
    c.set('a', 1);
    t = 90;
    c.set('a', 2);
    t = 150;
    expect(c.get('a')).toBe(2);
  });
});
