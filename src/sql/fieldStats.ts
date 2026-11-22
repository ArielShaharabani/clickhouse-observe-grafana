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
import {
  budgetSettingsFragments,
  buildRowEstimateQuery,
  ScanBudget,
  scanCompleteness,
  ScanStatus,
  STATS_SCAN_BUDGET,
} from './fullScan';

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

// ── Full-range scan (R5-SAMPLING) ────────────────────────────────────────────────────────────────
// "Scan full range": the same per-field profile over EVERY matching row in the time range instead
// of the newest `sampleSize`, under STATS_SCAN_BUDGET (sql/fullScan.ts). The sampled batch's
// sumMap / groupArray would hold every distinct value / every number in memory — unbounded over
// millions of rows — so the scan uses bounded aggregates instead:
// - top values: topKIf(topN, 1000, 'counts') — exact while a field has ≤ topN×1000 distinct
//   values; above that the counts carry an error bound and the field is marked `approximate`;
// - distinct: uniqIf (approximate above ~65k distinct values, also marked `approximate`);
// - numbers: exact min / max / count, quantileIf(0.5) median, and histogramIf(20) re-binned into
//   10 equal-width buckets client side (rebinHistogram).
// Output columns match the sampled batch where they can, so parseFieldStatsRow is reused.

/** topK capacity factor: counts are exact up to topN × this many distinct values. */
const TOPK_LOAD_FACTOR = 1000;
/** uniq() is exact (no sampling) below this many distinct values. */
const UNIQ_EXACT_BELOW = 65536;

export type FieldStatsFullScanOpts = Omit<FieldStatsBatchOpts, 'sampleSize'> & { budget?: ScanBudget };

export function buildFieldStatsFullScanQuery(
  config: SourceConfig,
  targets: FieldStatsTarget[],
  opts: FieldStatsFullScanOpts
): string {
  if (targets.length === 0) {
    return '';
  }
  const tbl = tableRef(config, opts.table);
  const topN = Math.max(1, Math.floor(opts.topN ?? 10));
  const condClause = opts.conditions.length > 0 ? `    WHERE ${opts.conditions.join(' AND ')}` : null;

  const inner: string[] = [];
  const mid: string[] = ['count() AS total'];
  const outer: string[] = ['total'];
  targets.forEach((t, i) => {
    inner.push(t.blankIsValue ? `toString(${t.sqlExpr}) AS v${i}` : `ifNull(toString(${t.sqlExpr}), '') AS v${i}`);
    const pr = present(`v${i}`, t.blankIsValue);
    mid.push(
      `countIf(${pr}) AS d${i}`,
      `uniqIf(v${i}, ${pr}) AS u${i}`,
      `topKIf(${topN}, ${TOPK_LOAD_FACTOR}, 'counts')(assumeNotNull(v${i}), ${pr}) AS k${i}`
    );
    outer.push(
      `d${i}`,
      `u${i}`,
      `arrayMap(x -> x.1, k${i}) AS tv${i}`,
      `arrayMap(x -> x.2, k${i}) AS tc${i}`,
      `arraySum(arrayMap(x -> x.3, k${i})) AS te${i}`
    );
    if (t.time) {
      mid.push(`minIf(v${i}, ${pr}) AS tmin${i}`, `maxIf(v${i}, ${pr}) AS tmax${i}`);
      outer.push(`ifNull(tmin${i}, '') AS tlo${i}`, `ifNull(tmax${i}, '') AS thi${i}`);
    }
    if (t.numeric) {
      const n = `toFloat64OrNull(v${i})`;
      const has = `isNotNull(${n})`;
      mid.push(
        `countIf(${has}) AS nn${i}`,
        `minIf(assumeNotNull(${n}), ${has}) AS lo${i}`,
        `maxIf(assumeNotNull(${n}), ${has}) AS hi${i}`,
        `quantileIf(0.5)(assumeNotNull(${n}), ${has}) AS med${i}`,
        `histogramIf(20)(assumeNotNull(${n}), ${has}) AS h${i}`
      );
      outer.push(`nn${i}`, `lo${i}`, `hi${i}`, `med${i}`, `arrayMap(x -> [x.1, x.2, x.3], h${i}) AS hg${i}`);
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
      `  )`,
      `)`,
    ],
    budgetSettingsFragments(config, opts.budget ?? STATS_SCAN_BUDGET)
  );
}

/**
 * Spreads ClickHouse `histogram()` bins ([lower, upper, height], adaptive widths) over 10
 * equal-width buckets from `min` to `max`, each bin's height split by overlap. A zero-width bin
 * goes whole into the bucket holding its value. Approximate by nature (so is `histogram`).
 */
export function rebinHistogram(bins: number[][], min: number, max: number): number[] {
  const out: number[] = new Array(10).fill(0);
  const width = (max - min) / 10;
  const bucketOf = (x: number) => (width > 0 ? Math.min(9, Math.max(0, Math.floor((x - min) / width))) : 0);
  for (const [lo, hi, h] of bins) {
    if (![lo, hi, h].every(Number.isFinite) || h <= 0) {
      continue;
    }
    if (hi <= lo || width <= 0) {
      out[bucketOf(lo)] += h;
      continue;
    }
    for (let b = 0; b < 10; b++) {
      const from = min + b * width;
      const to = b === 9 ? max : from + width;
      const overlap = Math.min(hi, to) - Math.max(lo, from);
      if (overlap > 0) {
        out[b] += (h * overlap) / (hi - lo);
      }
    }
  }
  return out.map((c) => Math.round(c));
}

export interface FullScanFieldStats extends FieldStats {
  /** Counts / distinct values are estimates (see the section comment). */
  approximate?: boolean;
}

export function parseFieldStatsFullScanRow(
  row: Record<string, unknown> | undefined,
  targets: FieldStatsTarget[],
  topN = 10
): FullScanFieldStats[] {
  return parseFieldStatsRow(row, targets).map((stats, i) => {
    if (!row) {
      return stats;
    }
    const out: FullScanFieldStats = { ...stats };
    // More distinct values than topK keeps = its counts may be off even when it reports no error.
    if (Number(row[`te${i}`] ?? 0) > 0 || stats.distinct > topN * TOPK_LOAD_FACTOR || stats.distinct >= UNIQ_EXACT_BELOW) {
      out.approximate = true;
    }
    if (targets[i].numeric && out.numeric && out.numeric.count > 0) {
      const bins = arr(row[`hg${i}`]).map((b) => arr(b).map(Number));
      out.numeric = { ...out.numeric, buckets: rebinHistogram(bins, out.numeric.min, out.numeric.max) };
    }
    return out;
  });
}

export interface FullScanResult {
  /** One entry per target; empty when the scan hit its time limit (no result at all). */
  stats: FullScanFieldStats[];
  status: ScanStatus;
}

/** Sum of EXPLAIN ESTIMATE `rows`, or undefined when the estimate can't be had. */
async function estimateRows(
  config: SourceConfig,
  table: string,
  conditions: string[],
  timeRange: TimeRange,
  signal?: AbortSignal
): Promise<number | undefined> {
  try {
    const rows = await runQueryRows({
      datasourceUid: config.datasourceUid,
      sql: buildRowEstimateQuery(config, table, conditions),
      timeRange,
      op: 'fieldStats',
      signal,
    });
    if (rows.length === 0 || !rows.every((r) => Number.isFinite(Number(r['rows'])))) {
      return undefined;
    }
    return rows.reduce((sum, r) => sum + Number(r['rows']), 0);
  } catch {
    return undefined;
  }
}

/** Runs the full-range scan and, alongside it, the row estimate that tells complete from partial.
 *  Throws when the scan query itself fails. */
export async function fetchFieldStatsFullScan(
  config: SourceConfig,
  targets: FieldStatsTarget[],
  opts: FieldStatsFullScanOpts & { timeRange: TimeRange; signal?: AbortSignal }
): Promise<FullScanResult> {
  const budget = opts.budget ?? STATS_SCAN_BUDGET;
  if (targets.length === 0) {
    return { stats: [], status: { scanned: 0, complete: true, budget } };
  }
  const sql = buildFieldStatsFullScanQuery(config, targets, { ...opts, budget });
  const [rows, estimatedRows] = await Promise.all([
    runQueryRows({ datasourceUid: config.datasourceUid, sql, timeRange: opts.timeRange, op: 'fieldStats', signal: opts.signal }),
    estimateRows(config, opts.table, opts.conditions, opts.timeRange, opts.signal),
  ]);
  // An aggregate without GROUP BY always returns one row; none means the time limit cut it off.
  const row = rows[0];
  const status = scanCompleteness({ scanned: row ? Number(row['total'] ?? 0) : 0, timedOut: !row, estimatedRows, budget });
  return { stats: row ? parseFieldStatsFullScanRow(row, targets, opts.topN) : [], status };
}
