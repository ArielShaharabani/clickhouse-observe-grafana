/**
 * Saved searches. Two stores:
 *  - shared: a Grafana dashboard (no panels) tagged `observe-saved-search` holds the search in its
 *    `observeSavedSearch` field, so every user who can see dashboards sees it, like Kibana saved
 *    objects. Reached through the viewer's own dashboard permissions (no plugin admin needed).
 *  - local: the browser's localStorage (legacy, and the fallback when the viewer cannot create
 *    dashboards).
 * Everything read back (either store) is untrusted and goes through sanitizeSavedSearch.
 */
import { getBackendSrv } from '@grafana/runtime';
import { SavedSearch } from '../types';
import { sanitizeFilterPills } from '../sql/filters';
import { isDashboardUid } from '../lens/panelSource';

const STORAGE_KEY = 'poortuna-clickhouse-observe:saved-searches';
export const SAVED_SEARCH_TAG = 'observe-saved-search';
const PAYLOAD_KEY = 'observeSavedSearch';
const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_SEARCH = 10000;
const MAX_TAGS = 20;
const MAX_TAG = 50;
const MAX_COLUMNS = 200;
const MAX_SHARED = 100;

const isStr = (v: unknown): v is string => typeof v === 'string';

/** A well-formed saved search from untrusted JSON, or null. Columns are re-resolved on load. */
export function sanitizeSavedSearch(raw: unknown): SavedSearch | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (!isStr(r.id) || !r.id || !isStr(r.name) || !r.name.trim() || r.name.length > MAX_NAME) {
    return null;
  }
  const search = r.search === undefined ? '' : r.search;
  if (!isStr(search) || search.length > MAX_SEARCH) {
    return null;
  }
  const out: SavedSearch = {
    id: r.id,
    name: r.name,
    search,
    filters: Array.isArray(r.filters) ? sanitizeFilterPills(r.filters) : [],
    columns: Array.isArray(r.columns)
      ? (r.columns.slice(0, MAX_COLUMNS).filter((c) => typeof c === 'object' && c !== null) as SavedSearch['columns'])
      : [],
    createdAt: isStr(r.createdAt) ? r.createdAt : '',
  };
  const sort = r.sort as Record<string, unknown> | undefined;
  if (sort && typeof sort === 'object' && isStr(sort.col) && (sort.dir === 'asc' || sort.dir === 'desc')) {
    out.sort = { col: sort.col, dir: sort.dir };
  }
  const tr = r.timeRange as Record<string, unknown> | undefined;
  if (tr && typeof tr === 'object' && isStr(tr.from) && isStr(tr.to) && tr.from.length < 64 && tr.to.length < 64) {
    out.timeRange = { from: tr.from, to: tr.to };
  }
  if (isStr(r.dataViewId) && r.dataViewId) {
    out.dataViewId = r.dataViewId;
  }
  if (isStr(r.description) && r.description.trim() && r.description.length <= MAX_DESCRIPTION) {
    out.description = r.description;
  }
  if (Array.isArray(r.tags)) {
    const tags = r.tags.filter((t): t is string => isStr(t) && !!t.trim() && t.length <= MAX_TAG).slice(0, MAX_TAGS);
    if (tags.length) {
      out.tags = tags;
    }
  }
  return out;
}

/** Splits user input "a, b" into clean unique tags. */
export function parseTags(input: string): string[] {
  return Array.from(new Set(input.split(',').map((t) => t.trim()).filter((t) => t && t.length <= MAX_TAG))).slice(
    0,
    MAX_TAGS
  );
}

function readLocal(): SavedSearch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.map(sanitizeSavedSearch).filter((s): s is SavedSearch => s !== null) : [];
  } catch {
    return [];
  }
}

function writeLocal(searches: SavedSearch[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(searches));
  } catch {
    // Storage full or unavailable: silently swallow.
  }
}

let sharedCache: SavedSearch[] = [];

/** Local searches plus the shared ones last fetched (synchronous; used for "unsaved changes"). */
export function loadSavedSearches(): SavedSearch[] {
  return [...readLocal(), ...sharedCache];
}

/** Local (browser-only) searches. */
export function loadLocalSearches(): SavedSearch[] {
  return readLocal();
}

/** The shared searches, from Grafana. Never rejects: an error yields what was cached. */
export async function loadSharedSearches(): Promise<SavedSearch[]> {
  try {
    const srv = getBackendSrv();
    const hits = await srv.get<Array<{ uid?: unknown }>>(
      `/api/search?${new URLSearchParams({ type: 'dash-db', tag: SAVED_SEARCH_TAG, limit: String(MAX_SHARED) })}`,
      undefined,
      undefined,
      { showErrorAlert: false }
    );
    const uids = (Array.isArray(hits) ? hits : []).map((h) => h?.uid).filter(isDashboardUid);
    const found = await Promise.all(
      uids.map(async (uid): Promise<SavedSearch | null> => {
        try {
          const res = await srv.get<{ dashboard?: Record<string, unknown> }>(
            `/api/dashboards/uid/${uid}`,
            undefined,
            undefined,
            { showErrorAlert: false }
          );
          const s = sanitizeSavedSearch(res?.dashboard?.[PAYLOAD_KEY]);
          return s ? { ...s, sharedUid: uid } : null;
        } catch {
          return null;
        }
      })
    );
    sharedCache = found.filter((s): s is SavedSearch => s !== null);
  } catch {
    // keep the cache
  }
  return sharedCache;
}

type NewSearch = Omit<SavedSearch, 'id' | 'createdAt' | 'sharedUid'>;

function newEntry(search: NewSearch, dataViewId?: string): SavedSearch {
  return {
    ...search,
    id: `ss_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
    ...(dataViewId ? { dataViewId } : {}),
  };
}

export function saveSearch(search: NewSearch, dataViewId?: string): SavedSearch {
  const entry = newEntry(search, dataViewId);
  writeLocal([...readLocal(), entry]);
  return entry;
}

/** Saves as a shared dashboard; rejects when the viewer may not create dashboards. */
export async function saveSharedSearch(search: NewSearch, dataViewId?: string): Promise<SavedSearch> {
  const entry = newEntry(search, dataViewId);
  const res = await getBackendSrv().post<{ uid?: unknown }>(
    '/api/dashboards/db',
    {
      dashboard: {
        id: null,
        uid: null,
        title: `Saved search: ${entry.name} (${entry.id})`.slice(0, 200),
        description: entry.description ?? '',
        tags: [SAVED_SEARCH_TAG, ...(entry.tags ?? [])].slice(0, MAX_TAGS + 1),
        panels: [],
        schemaVersion: 39,
        [PAYLOAD_KEY]: entry,
      },
      overwrite: false,
    },
    { showErrorAlert: false }
  );
  const saved = isDashboardUid(res?.uid) ? { ...entry, sharedUid: res.uid } : entry;
  sharedCache = [...sharedCache, saved];
  return saved;
}

export function updateSearch(id: string, patch: Partial<Omit<SavedSearch, 'id' | 'createdAt'>>): void {
  writeLocal(readLocal().map((s) => (s.id === id ? { ...s, ...patch } : s)));
}

export function deleteSearch(id: string): void {
  writeLocal(readLocal().filter((s) => s.id !== id));
}

export async function deleteSharedSearch(uid: string): Promise<void> {
  if (!isDashboardUid(uid)) {
    throw new Error('Invalid uid');
  }
  await getBackendSrv().delete(`/api/dashboards/uid/${uid}`, undefined, { showErrorAlert: false });
  sharedCache = sharedCache.filter((s) => s.sharedUid !== uid);
}
