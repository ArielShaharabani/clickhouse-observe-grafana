/**
 * One metadata layer for every schema/field-discovery query (`system.columns`, JSON paths): an
 * in-flight promise cache keyed by datasource + database + table + query kind (+ an optional
 * discriminator, e.g. the JSON column).
 *
 * Why: before this, App.tsx's top-level discovery, the page's own discovery, the data view wizard
 * and the column picker each issued the same `system.columns` / `distinctJSONPaths` query, so a
 * page load ran every one twice. Concurrent callers now share one request, and the settled result
 * is reused until its TTL passes or a refresh invalidates it. A rejected request is never cached.
 *
 * Map-key samples keep their own time-scoped cache in sql/keys.ts (their key carries a time
 * bucket and filter hash); `invalidateMetadata` is the one place a refresh clears schema entries.
 */

export type MetadataKind = 'columns' | 'jsonPaths';

/** Schema changes are rare; a session-long reuse with a generous TTL is what the existing
 *  per-table caches did. Explicit refresh (`invalidateMetadata`) overrides it. */
export const METADATA_TTL_MS = 600_000;

interface Entry {
  promise: Promise<unknown>;
  /** Set when the promise resolves; undefined while in flight. */
  settledAt?: number;
}

const entries = new Map<string, Entry>();

export interface MetadataKey {
  datasourceUid: string;
  database: string;
  table: string;
  kind: MetadataKind;
  /** Extra discriminator inside a kind (the JSON column name). */
  detail?: string;
}

const SEP = '\u0000';

function tablePrefix(datasourceUid: string, database: string, table: string): string {
  return `${datasourceUid}${SEP}${database}${SEP}${table}${SEP}`;
}

function keyString(k: MetadataKey): string {
  return `${tablePrefix(k.datasourceUid, k.database, k.table)}${k.kind}${SEP}${k.detail ?? ''}`;
}

/** Returns the cached or in-flight result for `key`, running `fetch` only when neither exists.
 *  `keep(value) === false` marks a settled value as partial: it is shared while in flight but not
 *  cached, so the next load asks again. */
export function loadMetadata<T>(key: MetadataKey, fetch: () => Promise<T>, keep?: (value: T) => boolean): Promise<T> {
  const k = keyString(key);
  const existing = entries.get(k);
  if (existing && (existing.settledAt === undefined || Date.now() - existing.settledAt < METADATA_TTL_MS)) {
    return existing.promise as Promise<T>;
  }
  const entry: Entry = {
    promise: fetch().then(
      (value) => {
        entry.settledAt = Date.now();
        if (keep && !keep(value) && entries.get(k) === entry) {
          entries.delete(k);
        }
        return value;
      },
      (err) => {
        if (entries.get(k) === entry) {
          entries.delete(k);
        }
        throw err;
      }
    ),
  };
  entries.set(k, entry);
  return entry.promise as Promise<T>;
}

/** Synchronous peek: true when a fresh settled result exists. */
export function hasFreshMetadata(key: MetadataKey): boolean {
  const e = entries.get(keyString(key));
  return !!e && e.settledAt !== undefined && Date.now() - e.settledAt < METADATA_TTL_MS;
}

/** Drops every cached/in-flight entry of one table (all kinds) — the refresh action. */
export function invalidateMetadata(datasourceUid: string, database: string, table: string): void {
  const prefix = tablePrefix(datasourceUid, database, table);
  for (const k of [...entries.keys()]) {
    if (k.startsWith(prefix)) {
      entries.delete(k);
    }
  }
}

/** Test-only. */
export function __resetMetadataCacheForTests(): void {
  entries.clear();
}
