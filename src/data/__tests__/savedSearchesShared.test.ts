const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ get: mockGet, post: mockPost, delete: mockDelete }),
}));

import {
  deleteSharedSearch,
  loadLocalSearches,
  loadSharedSearches,
  parseTags,
  saveSearch,
  saveSharedSearch,
  sanitizeSavedSearch,
} from '../savedSearches';

const base = { name: 'Errors', search: 'level:error', filters: [], columns: [] };

beforeEach(() => {
  window.localStorage.clear();
  jest.resetAllMocks();
});

describe('saved searches: shared store', () => {
  it('sanitizes untrusted payloads', () => {
    expect(sanitizeSavedSearch(null)).toBeNull();
    expect(sanitizeSavedSearch({ id: 'a', name: '', search: '' })).toBeNull();
    expect(sanitizeSavedSearch({ id: 'a', name: 'x', search: 5 })).toBeNull();
    const s = sanitizeSavedSearch({
      id: 'a',
      name: 'x',
      search: 'q',
      filters: [{ op: 'bogus', field: 'f' }, { op: '=', field: 'f', value: 'v' }],
      tags: ['ok', 3, ''],
      sort: { col: 'c', dir: 'sideways' },
      description: 'd',
      sharedUid: 'evil',
    })!;
    expect(s.filters).toHaveLength(1);
    expect(s.tags).toEqual(['ok']);
    expect(s.sort).toBeUndefined();
    expect(s.sharedUid).toBeUndefined();
  });

  it('parses tags', () => {
    expect(parseTags(' a, b ,a,,')).toEqual(['a', 'b']);
  });

  it('saves as a tagged dashboard with description and tags', async () => {
    mockPost.mockResolvedValue({ uid: 'abc123' });
    const s = await saveSharedSearch({ ...base, description: 'desc', tags: ['t1'] }, 'v1');
    const body = mockPost.mock.calls[0][1];
    expect(mockPost.mock.calls[0][0]).toBe('/api/dashboards/db');
    expect(body.dashboard.tags).toEqual(['observe-saved-search', 't1']);
    expect(body.dashboard.description).toBe('desc');
    expect(body.dashboard.observeSavedSearch.dataViewId).toBe('v1');
    expect(s.sharedUid).toBe('abc123');
  });

  it('lists shared searches, dropping malformed ones and bad uids', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/search')) {
        return [{ uid: 'good1' }, { uid: 'bad/../uid' }, { uid: 'bad2' }];
      }
      if (url.endsWith('good1')) {
        return { dashboard: { observeSavedSearch: { id: 'i', name: 'N', search: '', filters: [], columns: [] } } };
      }
      return { dashboard: { observeSavedSearch: { nope: true } } };
    });
    const list = await loadSharedSearches();
    expect(list.map((s) => [s.name, s.sharedUid])).toEqual([['N', 'good1']]);
  });

  it('rejects when the viewer cannot create dashboards; local save still works', async () => {
    mockPost.mockRejectedValue({ status: 403 });
    await expect(saveSharedSearch(base)).rejects.toBeDefined();
    saveSearch(base);
    expect(loadLocalSearches()).toHaveLength(1);
  });

  it('refuses a malformed uid on delete', async () => {
    await expect(deleteSharedSearch('../x')).rejects.toThrow();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
