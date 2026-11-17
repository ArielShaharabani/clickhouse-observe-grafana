/**
 * Fields pinned in the log detail panel (spec DISC-DOC-01): they stick to the top while stepping
 * through documents. Per browser tab (sessionStorage) and per table (`database.table`), keyed by
 * SQL expression, in pin order. Every read and write tolerates blocked storage.
 */
const STORAGE_KEY = 'clickhouse-observe.pinnedDocFields';

function readStore(): Record<string, string[]> {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function loadDocPins(table: string): string[] {
  const v = readStore()[table];
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
}

export function saveDocPins(table: string, pins: string[]): void {
  const store = readStore();
  store[table] = pins;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage blocked — pins still apply while the panel is open.
  }
}
