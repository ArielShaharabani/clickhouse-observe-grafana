import { loadFieldUsage, popularFieldIds, recordFieldUse } from '../fieldUsage';

describe('DISC-SIDEBAR-01 Popular fields usage counts', () => {
  beforeEach(() => localStorage.clear());

  it('counts uses per table and ranks most-used first', () => {
    recordFieldUse('default.spec_logs', 'col:ServiceName');
    recordFieldUse('default.spec_logs', 'col:ServiceName');
    recordFieldUse('default.spec_logs', 'col:SeverityText');
    recordFieldUse('default.otel_logs', 'col:Body');
    expect(loadFieldUsage('default.spec_logs')).toEqual({ 'col:ServiceName': 2, 'col:SeverityText': 1 });
    expect(popularFieldIds(loadFieldUsage('default.spec_logs'))).toEqual(['col:ServiceName', 'col:SeverityText']);
    expect(popularFieldIds(loadFieldUsage('default.otel_logs'))).toEqual(['col:Body']);
  });

  it('caps the list and survives corrupt or blocked storage', () => {
    expect(popularFieldIds({ a: 1, b: 3, c: 2, d: 0 }, 2)).toEqual(['b', 'c']);
    localStorage.setItem('clickhouse-observe.fieldUsage', 'not json');
    expect(loadFieldUsage('t')).toEqual({});
    const spy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(recordFieldUse('t', 'x')).toEqual({ x: 1 });
    // With storage blocked, the caller's in-memory counts keep counting.
    expect(recordFieldUse('t', 'x', { x: 2, y: 1 })).toEqual({ x: 3, y: 1 });
    spy.mockRestore();
  });

  it('filters ineligible ids before taking the top N', () => {
    const counts = { a: 9, b: 8, c: 7, d: 6, e: 5, f: 4 };
    expect(popularFieldIds(counts, 5, (id) => id === 'f' || id === 'e')).toEqual(['e', 'f']);
  });
});
