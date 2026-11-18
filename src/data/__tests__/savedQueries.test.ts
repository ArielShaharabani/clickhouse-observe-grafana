import {
  addSavedQuery,
  deleteSavedQuery,
  loadSavedQueries,
  SAVED_QUERIES_KEY,
  sanitizeSavedQuery,
  savedQueryNameTaken,
  updateSavedQuery,
} from '../savedQueries';

const pill = { id: 'p1', field: 'ServiceName', op: '=' as const, value: 'payments' };

beforeEach(() => window.localStorage.clear());

describe('saved queries store (DISC-SEARCH-03)', () => {
  it('adds, lists by name, updates and deletes', () => {
    const b = addSavedQuery({ name: ' Errors ', query: 'SeverityText : error', filters: [pill], dataViewId: 'v1' })!;
    addSavedQuery({ name: 'All', query: '' });
    expect(b.name).toBe('Errors');
    expect(loadSavedQueries('v1').map((q) => q.name)).toEqual(['All', 'Errors']);

    expect(updateSavedQuery(b.id, { name: 'Errors 2', query: 'x', dataViewId: 'v1' })).toBe(true);
    const updated = loadSavedQueries('v1').find((q) => q.id === b.id)!;
    expect(updated).toMatchObject({ name: 'Errors 2', query: 'x', createdAt: b.createdAt });
    expect(updated.filters).toBeUndefined();

    deleteSavedQuery(b.id);
    expect(loadSavedQueries('v1').map((q) => q.name)).toEqual(['All']);
    expect(updateSavedQuery('missing', { name: 'n', query: '' })).toBe(false);
  });

  it('scopes to the data view (plus view-less queries)', () => {
    addSavedQuery({ name: 'a', query: '', dataViewId: 'v1' });
    addSavedQuery({ name: 'b', query: '', dataViewId: 'v2' });
    addSavedQuery({ name: 'c', query: '' });
    expect(loadSavedQueries('v1').map((q) => q.name)).toEqual(['a', 'c']);
    expect(loadSavedQueries().map((q) => q.name)).toEqual(['a', 'b', 'c']);
  });

  it('detects name conflicts case-insensitively, except for the query being edited', () => {
    const q = addSavedQuery({ name: 'Errors', query: '', dataViewId: 'v1' })!;
    expect(savedQueryNameTaken('errors ', 'v1')).toBe(true);
    expect(savedQueryNameTaken('errors', 'v1', q.id)).toBe(false);
    expect(savedQueryNameTaken('errors', 'v2')).toBe(false);
  });

  it('treats storage as untrusted: drops malformed entries, hostile filters and bad time bounds', () => {
    window.localStorage.setItem(
      SAVED_QUERIES_KEY,
      JSON.stringify([
        null,
        { id: 'x' },
        { id: 'n', name: '   ', query: '' },
        { id: 'big', name: 'big', query: 'a'.repeat(20000) },
        {
          id: 'ok',
          name: 'ok',
          query: 'q',
          description: 42,
          filters: [pill, { field: 'x', op: "=') OR 1=1 --", value: 'v' }, { field: 'y', op: '=', value: { $gt: 1 } }],
          timeRange: { from: "now-1h'); DROP TABLE t; --", to: 'now' },
          dataViewId: 7,
        },
        { id: 't', name: 't', query: '', timeRange: { from: 'now-7d/d', to: '1700000000000' } },
      ])
    );
    const all = loadSavedQueries();
    expect(all.map((q) => q.id)).toEqual(['ok', 't']);
    const ok = all[0];
    expect(ok.filters).toEqual([pill]);
    expect(ok.timeRange).toBeUndefined();
    expect(ok.description).toBeUndefined();
    expect(ok.dataViewId).toBeUndefined();
    expect(all[1].timeRange).toEqual({ from: 'now-7d/d', to: '1700000000000' });
  });

  it('returns [] for corrupt storage', () => {
    window.localStorage.setItem(SAVED_QUERIES_KEY, '{not json');
    expect(loadSavedQueries()).toEqual([]);
    window.localStorage.setItem(SAVED_QUERIES_KEY, '{"a":1}');
    expect(loadSavedQueries()).toEqual([]);
    expect(sanitizeSavedQuery('str')).toBeNull();
  });
});
