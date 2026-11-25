/**
 * The prune column detected for a table, remembered per browser so the next visit's first query is
 * already pruned. Only ever a proven detection (sql/pruneColumn.ts); replaced by each new one.
 */
import { SourceConfig } from '../types';
import { PruneColumn } from '../sql/pruneColumn';

const KEY = 'poortuna-clickhouse-observe:prune-hints';
const MAX_HINTS = 100;

type Hints = Record<string, PruneColumn>;

export function pruneHintKey(c: SourceConfig): string {
  return [c.datasourceUid, c.database, c.logsTable, c.columns.timestamp, c.columns.partitionTimestamp].join('\u0000');
}

function read(): Hints {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Hints) : {};
  } catch {
    return {};
  }
}

export function loadPruneHint(key: string): PruneColumn | null {
  const h = read()[key];
  // Goes into SQL: a plain identifier and a whole number only.
  return h && /^[A-Za-z_][A-Za-z0-9_]*$/.test(String(h.column)) && Number.isInteger(h.widenSeconds) && h.widenSeconds > 0
    ? { column: h.column, widenSeconds: h.widenSeconds }
    : null;
}

export function savePruneHint(key: string, prune: PruneColumn | null): void {
  const hints = read();
  const prev = hints[key];
  if (prune ? prev?.column === prune.column && prev?.widenSeconds === prune.widenSeconds : !prev) {
    return;
  }
  delete hints[key];
  const entries = Object.entries(hints);
  if (prune) {
    entries.push([key, prune]);
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries.slice(-MAX_HINTS))));
  } catch {
    // storage unavailable: the next visit detects again
  }
}
