/**
 * ISO 8601 (UTC) form of a timestamp value as it arrives from the datasource, for the document
 * JSON view (Kibana shows `@timestamp` as ISO, not epoch ms). Numbers are epoch milliseconds;
 * ClickHouse DateTime / DateTime64 text ("2026-01-05 10:33:30.123456789", UTC) keeps its full
 * fractional precision. Anything unrecognised is returned unchanged.
 */
const CH_DATETIME = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,9})?Z?$/;

export function toIsoTimestamp(value: unknown): unknown {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? new Date(value).toISOString() : value;
  }
  if (typeof value === 'string') {
    const m = CH_DATETIME.exec(value.trim());
    return m ? `${m[1]}T${m[2]}${m[3] ?? ''}Z` : value;
  }
  if (value instanceof Date) {
    return Number.isFinite(value.valueOf()) ? value.toISOString() : value;
  }
  if (value && typeof value === 'object' && typeof (value as { valueOf?: unknown }).valueOf === 'function') {
    const ms = Number((value as { valueOf: () => unknown }).valueOf());
    return Number.isFinite(ms) ? new Date(ms).toISOString() : value;
  }
  return value;
}

/** Copy of `row` with the given time keys rewritten by toIsoTimestamp. */
export function withIsoTimestamps<T extends Record<string, unknown>>(row: T, keys: Array<string | undefined>): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) {
    if (k && k in out && out[k] !== null && out[k] !== undefined) {
      out[k] = toIsoTimestamp(out[k]);
    }
  }
  return out as T;
}
