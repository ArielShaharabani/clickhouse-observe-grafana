/**
 * Field statistics tab (DISC-FIELDSTATS-01): one sampled aggregation per batch of fields.
 *
 * Every field in a batch is profiled over the SAME sample (the `sampleSize` most recent rows that
 * match the page's query + filters), read once. Per field: documents with a value, distinct
 * values, the top values with counts and — for numbers — min / median / max and a 10-bucket
 * equal-width distribution, the same shape as the field popover (buildNumericStatsQuery).
 *
 * SQL safety: `sqlExpr` comes from field discovery (FieldModel, built with quoted identifiers),
 * never from the URL or other user input; aliases are positional (`v0`, `n0`, …) so a field name
 * never reaches the SQL text as an identifier.
 */
import { TimeRange } from '@grafana/data';
import { SourceConfig } from '../types';
import { tableRef } from './queryBuilder';
import { configSettingsFragments, withSettings } from './settings';
import { timeExpr } from './timeExpr';
import { runQueryRows } from '../data/runQuery';

export interface FieldStatsTarget {
  sqlExpr: string;
  numeric: boolean;
  /** Time field: profiled as a min / max range instead of categories. */
  time?: boolean;
  /** An empty string is a value (shown as "(blank)"), only NULL is missing — true for real columns,
   *  false for Map keys, where ClickHouse returns '' for an absent key. */
  blankIsValue?: boolean;
}

export interface FieldStatsBatchOpts {
  table: string;
  /** Pre-built WHERE conditions (buildWhereConditions). */
  conditions: string[];
  sampleSize: number;
  /** Top values kept per field. */
  topN?: number;
}

export interface FieldTopValue {
  value: string;
  count: number;
}

export interface FieldNumericSummary {
  min: number;
  max: number;
  median: number;
  /** Sampled rows with a numeric value. */
  count: number;
  /** 10 equal-width bucket counts from min to max. */
  buckets: number[];
}

export interface FieldStats {
  /** Rows in the sample (same for every field of a batch). */
  sampled: number;
  /** Sampled rows where the field has a (non-empty) value. */
  docs: number;
  distinct: number;
  top: FieldTopValue[];
  numeric?: FieldNumericSummary;
  /** Time fields: earliest / latest value in the sample (text as ClickHouse renders it). */
  range?: { min: string; max: string };
}

/** Same "absent" stand-ins buildFieldTopValuesQuery drops (empty, '{}', '[]', 'null'). With
 *  `blankIsValue` the empty string counts (Kibana's "(blank)") and only NULL is missing. */
const present = (v: string, blankIsValue?: boolean) =>
  blankIsValue ? `(isNotNull(${v}) AND ${v} NOT IN ('{}', '[]', 'null'))` : `(notEmpty(${v}) AND ${v} NOT IN ('{}', '[]', 'null'))`;

export function buildFieldStatsBatchQuery(
  config: SourceConfig,
  targets: FieldStatsTarget[],
  opts: FieldStatsBatchOpts
): string {
  if (targets.length === 0) {
    return '';
  }
  const tbl = tableRef(config, opts.table);
  const tsCol = timeExpr(config); // converted (epoch / text) time fields sort as DateTime64 (#16d)
  const topN = Math.max(1, Math.floor(opts.topN ?? 10));
  const sampleSize = Math.max(1, Math.floor(opts.sampleSize));
  const condClause = opts.conditions.length > 0 ? `    WHERE ${opts.conditions.join(' AND ')}` : null;

  const inner: string[] = [];
  const mid: string[] = ['count() AS total'];
  const outer: string[] = ['total'];
  targets.forEach((t, i) => {
    inner.push(t.blankIsValue ? `toString(${t.sqlExpr}) AS v${i}` : `ifNull(toString(${t.sqlExpr}), '') AS v${i}`);
    const pr = present(`v${i}`, t.blankIsValue);
    // value -> count over the sample, absent values left out.
    mid.push(`sumMap(if(${pr}, [assumeNotNull(v${i})], []), if(${pr}, [toUInt64(1)], [])) AS m${i}`);
    if (t.time) {
      // DateTime / Date render as fixed-width sortable text, so string min / max is the time range.
      mid.push(`minIf(v${i}, ${pr}) AS tmin${i}`, `maxIf(v${i}, ${pr}) AS tmax${i}`);
      outer.push(`ifNull(tmin${i}, '') AS tlo${i}`, `ifNull(tmax${i}, '') AS thi${i}`);
    }
    const sorted = `arraySlice(arrayReverseSort(x -> x.2, arrayZip(tupleElement(m${i}, 1), tupleElement(m${i}, 2))), 1, ${topN})`;
    outer.push(
      `arraySum(tupleElement(m${i}, 2)) AS d${i}`,
      `length(tupleElement(m${i}, 1)) AS u${i}`,
      `arrayMap(x -> x.1, ${sorted}) AS tv${i}`,
      `arrayMap(x -> x.2, ${sorted}) AS tc${i}`
    );
    if (t.numeric) {
      mid.push(`groupArrayIf(toFloat64OrNull(v${i}), isNotNull(toFloat64OrNull(v${i}))) AS a${i}`);
      const lo = `arrayMin(a${i})`;
      const hi = `arrayMax(a${i})`;
      outer.push(
        `length(a${i}) AS nn${i}`,
        `if(length(a${i}) > 0, ${lo}, 0) AS lo${i}`,
        `if(length(a${i}) > 0, ${hi}, 0) AS hi${i}`,
        `if(length(a${i}) > 0, arrayReduce('quantileExact(0.5)', a${i}), 0) AS med${i}`,
        `if(length(a${i}) > 0, arrayMap(b -> arrayCount(x -> least(9, toUInt32(floor(if(${hi} > ${lo}, (x - ${lo}) / (${hi} - ${lo}), 0) * 10))) = b, a${i}), range(10)), []) AS bk${i}`
      );
    }
  });

  return withSettings(
    [
      `SELECT ${outer.join(',\n  ')}`,
      `FROM (`,
      `  SELECT ${mid.join(',\n    ')}`,
      `  FROM (`,
      `    SELECT ${inner.join(', ')}`,
      `    FROM ${tbl}`,
      condClause,
      tsCol ? `    ORDER BY ${tsCol} DESC` : null,
      `    LIMIT ${sampleSize}`,
      `  )`,
      `)`,
    ],
    configSettingsFragments(config)
  );
}

/** Array columns may arrive as an array or as JSON text depending on the datasource frame format. */
function arr(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  if (typeof raw === 'string' && raw.startsWith('[')) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function parseFieldStatsRow(
  row: Record<string, unknown> | undefined,
  targets: FieldStatsTarget[]
): FieldStats[] {
  const sampled = row ? Number(row['total'] ?? 0) : 0;
  return targets.map((t, i) => {
    if (!row) {
      return { sampled: 0, docs: 0, distinct: 0, top: [] };
    }
    const values = arr(row[`tv${i}`]).map((v) => String(v));
    const counts = arr(row[`tc${i}`]).map(Number);
    const stats: FieldStats = {
      sampled,
      docs: Number(row[`d${i}`] ?? 0),
      distinct: Number(row[`u${i}`] ?? 0),
      top: values.map((value, j) => ({ value, count: counts[j] ?? 0 })),
    };
    if (t.time && stats.docs > 0) {
      stats.range = { min: String(row[`tlo${i}`] ?? ''), max: String(row[`thi${i}`] ?? '') };
    }
    if (t.numeric) {
      const count = Number(row[`nn${i}`] ?? 0);
      const buckets = arr(row[`bk${i}`]).map(Number);
      while (buckets.length < 10) {
        buckets.push(0);
      }
      stats.numeric = {
        count,
        min: Number(row[`lo${i}`] ?? 0),
        max: Number(row[`hi${i}`] ?? 0),
        median: Number(row[`med${i}`] ?? 0),
        buckets: count > 0 ? buckets.slice(0, 10) : [],
      };
    }
    return stats;
  });
}

export async function fetchFieldStatsBatch(
  config: SourceConfig,
  targets: FieldStatsTarget[],
  opts: FieldStatsBatchOpts & { timeRange: TimeRange; signal?: AbortSignal }
): Promise<FieldStats[]> {
  if (targets.length === 0) {
    return [];
  }
  const sql = buildFieldStatsBatchQuery(config, targets, opts);
  const rows = await runQueryRows({
    datasourceUid: config.datasourceUid,
    sql,
    timeRange: opts.timeRange,
    op: 'fieldStats',
    signal: opts.signal,
  });
  return parseFieldStatsRow(rows[0], targets);
}
