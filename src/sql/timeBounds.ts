/**
 * Earliest / latest event time of a data view, for Discover's "Search entire time range" button
 * (Kibana's empty-results help). One aggregate over the table's time field — a MergeTree sorted
 * by time answers min / max from the primary index, so it stays cheap; no user text is involved.
 */
import { TimeRange } from '@grafana/data';
import { SourceConfig } from '../types';
import { runQueryRows } from '../data/runQuery';
import { tableRef } from './queryBuilder';
import { configSettingsFragments, queryTimeoutFragments, withSettings } from './settings';
import { timeExpr } from './timeExpr';

export interface TimeBounds {
  fromMs: number;
  toMs: number;
}

export function buildTimeBoundsQuery(config: SourceConfig, table: string = config.logsTable): string {
  const ts = timeExpr(config);
  if (!ts) {
    return '';
  }
  const ms = (agg: string) => `toUnixTimestamp64Milli(toDateTime64(${agg}(${ts}), 3, 'UTC'))`;
  return withSettings(
    [`SELECT ${ms('min')} AS lo, ${ms('max')} AS hi`, `FROM ${tableRef(config, table)}`],
    [...queryTimeoutFragments(config), ...configSettingsFragments(config)]
  );
}

/** Null when the table is empty or has no time field. */
export async function fetchTimeBounds(
  config: SourceConfig,
  timeRange: TimeRange,
  signal?: AbortSignal
): Promise<TimeBounds | null> {
  const sql = buildTimeBoundsQuery(config);
  if (!sql) {
    return null;
  }
  const rows = await runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange, op: 'timeBounds', signal });
  const lo = Number(rows[0]?.['lo']);
  const hi = Number(rows[0]?.['hi']);
  // An empty table aggregates to the epoch (min / max over no rows).
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || (lo <= 0 && hi <= 0)) {
    return null;
  }
  return { fromMs: lo, toMs: hi };
}
