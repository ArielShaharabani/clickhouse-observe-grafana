/**
 * Saved queries (DISC-SEARCH-03): a named query + filters (optionally the time range), lighter than
 * a saved search (which also carries columns and sort). Stored per browser in localStorage.
 *
 * Everything read back from storage is untrusted (another tab, an extension or a hand edit can
 * write anything): entries are rebuilt field by field, filters go through sanitizeFilterPills, and
 * a time range is kept only when both ends are a relative `now…` expression or epoch milliseconds.
 */

import { FilterPill } from '../types';
import { sanitizeFilterPills } from '../sql/filters';

export interface SavedQuery {
  id: string;
  name: string;
  description?: string;
  query: string;
  /** Present when the query was saved with "Include filters". */
  filters?: FilterPill[];
  /** Present when the query was saved with "Include time filter". */
  timeRange?: { from: string; to: string };
  /** Data view the query was saved on; queries without one show on every view. */
  dataViewId?: string;
  createdAt: string;
}

export const SAVED_QUERIES_KEY = 'poortuna-clickhouse-observe:saved-queries';

/** Upper bounds that keep a corrupt or hostile entry from bloating the menu. */
const MAX_NAME = 200;
const MAX_DESCRIPTION = 1000;
const MAX_QUERY = 10000;
const MAX_ENTRIES = 500;

const RELATIVE_TIME_RE = /^now([+-]\d+[smhdwMy])*(\/[smhdwMy])?$/;
const EPOCH_MS_RE = /^\d{1,15}$/;

function isTimeBound(v: unknown): v is string {
  return typeof v === 'string' && (RELATIVE_TIME_RE.test(v) || EPOCH_MS_RE.test(v));
}

/** Rebuilds one stored entry; null when it is not a usable saved query. */
export function sanitizeSavedQuery(raw: unknown): SavedQuery | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || !r.id || typeof r.name !== 'string' || !r.name.trim() || typeof r.query !== 'string') {
    return null;
  }
  if (r.name.length > MAX_NAME || r.query.length > MAX_QUERY) {
    return null;
  }
  const out: SavedQuery = {
    id: r.id,
    name: r.name,
    query: r.query,
    createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
  };
  if (typeof r.description === 'string' && r.description && r.description.length <= MAX_DESCRIPTION) {
    out.description = r.description;
  }
  if (Array.isArray(r.filters)) {
    out.filters = sanitizeFilterPills(r.filters);
  }
  if (typeof r.timeRange === 'object' && r.timeRange !== null) {
    const t = r.timeRange as Record<string, unknown>;
    if (isTimeBound(t.from) && isTimeBound(t.to)) {
      out.timeRange = { from: t.from, to: t.to };
    }
  }
  if (typeof r.dataViewId === 'string' && r.dataViewId) {
    out.dataViewId = r.dataViewId;
  }
  return out;
}

function readAll(): SavedQuery[] {
  try {
    const raw = window.localStorage.getItem(SAVED_QUERIES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .slice(0, MAX_ENTRIES)
      .map(sanitizeSavedQuery)
      .filter((q): q is SavedQuery => q !== null);
  } catch {
    return [];
  }
}

function writeAll(queries: SavedQuery[]): boolean {
  try {
    window.localStorage.setItem(SAVED_QUERIES_KEY, JSON.stringify(queries));
    return true;
  } catch {
    return false;
  }
}

/** Saved queries visible on `dataViewId` (its own + view-less ones), sorted by name. */
export function loadSavedQueries(dataViewId?: string): SavedQuery[] {
  return readAll()
    .filter((q) => !dataViewId || !q.dataViewId || q.dataViewId === dataViewId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** True when another saved query (not `exceptId`) visible on the view already uses `name`. */
export function savedQueryNameTaken(name: string, dataViewId?: string, exceptId?: string): boolean {
  const n = name.trim().toLowerCase();
  return loadSavedQueries(dataViewId).some((q) => q.id !== exceptId && q.name.trim().toLowerCase() === n);
}

export type SavedQueryInput = Omit<SavedQuery, 'id' | 'createdAt'>;

/** Stores a new saved query; null when storage is unavailable. */
export function addSavedQuery(input: SavedQueryInput): SavedQuery | null {
  const entry: SavedQuery = {
    ...input,
    name: input.name.trim(),
    id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(),
  };
  return writeAll([...readAll(), entry]) ? entry : null;
}

/** Replaces the saved query with `id` (keeps id and createdAt). False when not found / not stored. */
export function updateSavedQuery(id: string, input: SavedQueryInput): boolean {
  const all = readAll();
  const idx = all.findIndex((q) => q.id === id);
  if (idx < 0) {
    return false;
  }
  const next = [...all];
  next[idx] = { ...input, name: input.name.trim(), id, createdAt: all[idx].createdAt };
  return writeAll(next);
}

export function deleteSavedQuery(id: string): void {
  writeAll(readAll().filter((q) => q.id !== id));
}
