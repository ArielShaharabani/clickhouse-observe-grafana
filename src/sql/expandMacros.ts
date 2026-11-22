import type { TimeRange } from '@grafana/data';

/**
 * Expands the datasource's time macros in generated SQL the way the ClickHouse datasource does
 * before sending, so the SQL inspector shows the values actually queried. Display only: the query
 * itself keeps the macros (the backend expands them). Values the builder embeds never contain a
 * literal `$__` (it escapes `$` as \x24), so a plain replace cannot touch user text.
 */
export function expandTimeMacros(sql: string, range: Pick<TimeRange, 'from' | 'to'>): string {
  const from = Math.floor(range.from.valueOf() / 1000);
  const to = Math.floor(range.to.valueOf() / 1000);
  return sql
    .replace(/\$__fromTime\b/g, `toDateTime(${from})`)
    .replace(/\$__toTime\b/g, `toDateTime(${to})`);
}
