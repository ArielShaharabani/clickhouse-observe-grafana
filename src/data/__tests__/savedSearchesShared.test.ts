const mockGet = jest.fn();
const mockPost = jest.fn();
const mockDelete = jest.fn();
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getBackendSrv: () => ({ get: mockGet, post: mockPost, delete: mockDelete }),
}));

import {
  deleteSharedSearch,
  findSavedSearch,
  resetSavedSearchFolderCache,
  savedSearchTimeRange,
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
  resetSavedSearchFolderCache();
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

  it('keeps the current range when no time was stored', () => {
    expect(savedSearchTimeRange({ ...base, id: 'a', createdAt: '' })).toBeUndefined();
    const tr = savedSearchTimeRange({ ...base, id: 'a', createdAt: '', timeRange: { from: 'now-1h', to: 'now' } });
    expect(tr?.raw.from).toBe('now-1h');
  });

  it('parses tags', () => {
    expect(parseTags(' a, b ,a,,')).toEqual(['a', 'b']);
  });

  const FOLDER = '/apis/folder.grafana.app/v1/namespaces/default/folders';
  const folderObj = { metadata: { name: 'observe-saved-searches' } };

  it('saves as a tagged dashboard in the Observe saved searches folder', async () => {
    mockGet.mockResolvedValue(folderObj);
    mockPost.mockResolvedValue({ uid: 'abc123' });
    const s = await saveSharedSearch({ ...base, description: 'desc', tags: ['t1'] }, 'v1');
    expect(mockGet.mock.calls[0][0]).toBe(`${FOLDER}/observe-saved-searches`);
    const body = mockPost.mock.calls[0][1];
    expect(mockPost.mock.calls[0][0]).toBe('/api/dashboards/db');
    expect(body.folderUid).toBe('observe-saved-searches');
    expect(body.dashboard.tags).toEqual(['observe-saved-search', 't1']);
    expect(body.dashboard.description).toBe('desc');
    expect(body.dashboard.observeSavedSearch.dataViewId).toBe('v1');
    expect(s.sharedUid).toBe('abc123');
  });

  it('creates the folder when it is missing, once', async () => {
    mockGet.mockRejectedValue({ status: 404 });
    mockPost.mockImplementation(async (url: string) => (url === FOLDER ? folderObj : { uid: 'd1' }));
    await saveSharedSearch(base);
    await saveSharedSearch(base);
    const folderPosts = mockPost.mock.calls.filter((c) => c[0] === FOLDER);
    expect(folderPosts).toHaveLength(1);
    expect(folderPosts[0][1]).toEqual({
      metadata: { name: 'observe-saved-searches' },
      spec: { title: 'Observe saved searches' },
    });
    expect(mockPost.mock.calls.filter((c) => c[0] === '/api/dashboards/db')[1][1].folderUid).toBe(
      'observe-saved-searches'
    );
  });

  it('falls back to General when the folder cannot be created', async () => {
    mockGet.mockRejectedValue({ status: 403 });
    mockPost.mockImplementation(async (url: string) => {
      if (url === FOLDER) {
        throw { status: 403 };
      }
      return { uid: 'd1' };
    });
    await saveSharedSearch(base);
    const dash = mockPost.mock.calls.find((c) => c[0] === '/api/dashboards/db')!;
    expect(dash[1].folderUid).toBeUndefined();
  });

  it('falls back to General when the folder is not writable', async () => {
    mockGet.mockResolvedValue(folderObj);
    let n = 0;
    mockPost.mockImplementation(async () => {
      if (n++ === 0) {
        throw { status: 403 };
      }
      return { uid: 'd2' };
    });
    const s = await saveSharedSearch(base);
    expect(mockPost.mock.calls[0][1].folderUid).toBe('observe-saved-searches');
    expect(mockPost.mock.calls[1][1].folderUid).toBeUndefined();
    expect(s.sharedUid).toBe('d2');
  });

  it('finds a saved search by id through the title search', async () => {
    mockGet.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/search')) {
        expect(url).toContain('query=ss_1_abc');
        return [{ uid: 'dash1' }];
      }
      return { dashboard: { observeSavedSearch: { id: 'ss_1_abc', name: 'N', search: '', filters: [], columns: [] } } };
    });
    expect((await findSavedSearch('ss_1_abc'))?.sharedUid).toBe('dash1');
    expect(await findSavedSearch('../bad')).toBeUndefined();
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
