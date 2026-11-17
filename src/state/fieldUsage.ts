/**
 * Field usage counts behind the field list's "Popular fields" group (spec DISC-SIDEBAR-01: the
 * group appears once fields are used). A field is "used" when it's added as a column or filtered
 * on from the field list. Per viewer and per table, in localStorage — a convenience, so every
 * read and write tolerates blocked storage.
 */
const STORAGE_KEY = 'clickhouse-observe.fieldUsage';

type UsageStore = Record<string, Record<string, number>>;

function readStore(): UsageStore {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** Usage counts for one table (`database.table`), field id → times used. */
export function loadFieldUsage(table: string): Record<string, number> {
  const t = readStore()[table];
  return t && typeof t === 'object' ? t : {};
}

/** Records one use of a field and returns the table's updated counts. `base` is the caller's
 *  current in-memory counts, so counting still works for the page view when storage is blocked. */
export function recordFieldUse(table: string, fieldId: string, base?: Record<string, number>): Record<string, number> {
  const store = readStore();
  const counts = { ...(base ?? store[table] ?? {}) };
  counts[fieldId] = (Number(counts[fieldId]) || 0) + 1;
  store[table] = counts;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked — the count still applies for this page view.
  }
  return counts;
}

/** Most-used field ids first (ties by id for a stable order), at most `limit`, considering only
 *  ids `eligible` accepts (filter before the cut, so ineligible ids never take a slot). */
export function popularFieldIds(
  counts: Record<string, number>,
  limit = 5,
  eligible: (id: string) => boolean = () => true
): string[] {
  return Object.entries(counts)
    .filter(([id, n]) => Number(n) > 0 && eligible(id))
    .sort(([a, n], [b, m]) => Number(m) - Number(n) || a.localeCompare(b))
    .slice(0, limit)
    .map(([id]) => id);
}
