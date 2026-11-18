/**
 * DISC-SESSION-01 "Create alert rule" (from the current Discover query): the ClickHouse query a
 * Grafana-managed alert rule evaluates. One number — the count of matching documents in the rule's
 * own time window ($__fromTime / $__toTime, expanded by the ClickHouse datasource from the rule's
 * relative time range) — so a threshold expression can read it directly.
 *
 * The WHERE clause is exactly Discover's (buildWhereConditions: search, enabled filters, time
 * bounds), so every user value is already escaped there. The datasource expands `$__…` macros
 * anywhere in the SQL text, including inside string literals, so `$` inside literals is written as
 * the ClickHouse escape `\x24` (same as the Lens dashboard export) — a search for `$__fromTime`
 * stays a literal search.
 */
import { LogsQueryState, SourceConfig } from '../types';
import { buildWhereConditions, tableRef } from './queryBuilder';
import { FieldIndex } from './fields';
import { configSettingsFragments, queryTimeoutFragments, withSettings } from './settings';

/**
 * Replaces `$` inside single-quoted string literals with `\x24`. Literals produced by quoteString
 * escape `\` and `'` with a backslash; `''` is also accepted as an escaped quote.
 */
export function escapeDollarInLiterals(sql: string): string {
  let out = '';
  let inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (!inStr) {
      if (ch === "'") {
        inStr = true;
      }
      out += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < sql.length) {
      out += ch + sql[i + 1];
      i++;
      continue;
    }
    if (ch === "'") {
      if (sql[i + 1] === "'") {
        out += "''";
        i++;
        continue;
      }
      inStr = false;
      out += ch;
      continue;
    }
    out += ch === '$' ? '\\x24' : ch;
  }
  return out;
}

/** '' when the view has no timestamp column (an alert needs a time window). */
export function buildAlertCountQuery(config: SourceConfig, state: LogsQueryState, index?: FieldIndex): string {
  if (!config.columns.timestamp) {
    return '';
  }
  const conditions = buildWhereConditions(config, state, index);
  const sql = withSettings(
    [
      `SELECT count() AS value`,
      `FROM ${tableRef(config, config.logsTable)}`,
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : null,
    ],
    [...queryTimeoutFragments(config), ...configSettingsFragments(config)]
  );
  return escapeDollarInLiterals(sql);
}
