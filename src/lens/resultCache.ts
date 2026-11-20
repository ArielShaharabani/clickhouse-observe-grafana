/**
 * Small LRU + TTL cache of Visualize query results (PERF-QUERIES #5). Switching Bar -> Line -> Area
 * compiles the identical SQL; the rows are reused instead of re-running a ~1 s scan. The key is the
 * compiled SQL plus the datasource and the resolved time range, so anything that changes the query
 * misses. An explicit Refresh bypasses (and overwrites) the entry.
 */
export const RESULT_CACHE_MAX = 8;
export const RESULT_CACHE_TTL_MS = 60_000;

interface Entry<T> {
  value: T;
  at: number;
}

export class ResultCache<T> {
  private map = new Map<string, Entry<T>>();
  constructor(
    private max = RESULT_CACHE_MAX,
    private ttlMs = RESULT_CACHE_TTL_MS,
    private now: () => number = Date.now
  ) {}

  static key(datasourceUid: string, sql: string, fromMs: number, toMs: number): string {
    return JSON.stringify([datasourceUid, sql, fromMs, toMs]);
  }

  get(key: string): T | undefined {
    const e = this.map.get(key);
    if (!e) {
      return undefined;
    }
    if (this.now() - e.at > this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    // Re-insert so the Map's order stays least-recently-used first.
    this.map.delete(key);
    this.map.set(key, e);
    return e.value;
  }

  set(key: string, value: T): void {
    this.map.delete(key);
    this.map.set(key, { value, at: this.now() });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value as string);
    }
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
