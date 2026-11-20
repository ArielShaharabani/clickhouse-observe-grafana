/**
 * LENS-INSPECT-01 (docs/spec/20-lens.md): pure helpers behind the Visualize Inspector — the Data
 * view's table (columns, cell filter values, sorting, CSV) and the Requests view's latest chart
 * query, read from the diagnostics tracer (the same spans the Discover Diagnostics drawer shows).
 */
import { dateTime } from '@grafana/data';
import { Span } from '../diag/types';
import { LensResult } from './compile';
import { formatMetricValue } from './render/MetricTiles';
import { BucketDim, LensState, MetricDim, MISSING_VALUE, OTHER_VALUE } from './state';

export type InspectorCell = string | number | null;

export interface InspectorColumn {
  label: string;
  /** Bucket columns come first (in `state.buckets` order), then one column per metric. */
  role: 'bucket' | 'metric';
  /** Bucket columns: the dimension (filter actions, time formatting). */
  bucket?: BucketDim;
  isTime: boolean;
  /** Metric columns: the metric, for its Value format (Percent, Bytes, …). */
  metric?: MetricDim;
}

export interface InspectorTable {
  columns: InspectorColumn[];
  rows: InspectorCell[][];
}

/** The chart's tabular data (`LensResult.table`) with each column's role. */
export function inspectorTable(state: LensState, data: LensResult | undefined): InspectorTable {
  if (!data) {
    return { columns: [], rows: [] };
  }
  const columns: InspectorColumn[] = data.table.columns.map((label, i) => {
    const bucket = state.buckets[i];
    return bucket
      ? { label, role: 'bucket', bucket, isTime: bucket.kind === 'date_histogram' }
      : { label, role: 'metric', isTime: false, metric: state.metrics[i - state.buckets.length] };
  });
  return { columns, rows: data.table.rows };
}

/**
 * The value a ⊕/⊖ filter on a bucket cell filters on, or null when the cell can't be filtered:
 * not a top-values bucket (date buckets have no single value), an empty cell, or the synthetic
 * "Other" / "(missing)" bucket. Mirrors the labelling in compile.ts's termCell: a real value
 * spelled like an enabled synthetic label is shown with a " (value)" suffix, so it is mapped back.
 */
export function cellFilterValue(bucket: BucketDim | undefined, cell: InspectorCell): string | null {
  if (!bucket || bucket.kind !== 'terms' || cell === null || cell === undefined) {
    return null;
  }
  const label = String(cell);
  if ((bucket.other && label === OTHER_VALUE) || (bucket.missing && label === MISSING_VALUE)) {
    return null;
  }
  if (bucket.other && label === `${OTHER_VALUE} (value)`) {
    return OTHER_VALUE;
  }
  if (bucket.missing && label === `${MISSING_VALUE} (value)`) {
    return MISSING_VALUE;
  }
  return label;
}

/** Display text of a cell: date buckets as local date-time, numbers grouped, null as "-". */
export function formatCell(col: InspectorColumn, cell: InspectorCell): string {
  if (cell === null || cell === undefined) {
    return '-';
  }
  if (col.isTime && typeof cell === 'number') {
    return dateTime(cell).format('YYYY-MM-DD HH:mm:ss');
  }
  if (typeof cell === 'number') {
    if (col.metric) {
      return formatMetricValue(col.metric, cell);
    }
    return cell.toLocaleString(undefined, { maximumFractionDigits: 3 });
  }
  return String(cell);
}

export interface InspectorSort {
  col: number;
  dir: 'asc' | 'desc';
}

/** Rows sorted by one column: numbers numerically, text by locale; empty cells always last. */
export function sortRows(rows: InspectorCell[][], sort: InspectorSort | null): InspectorCell[][] {
  if (!sort) {
    return rows;
  }
  const sign = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[sort.col];
    const y = b[sort.col];
    if (x === null || x === undefined) {
      return y === null || y === undefined ? 0 : 1;
    }
    if (y === null || y === undefined) {
      return -1;
    }
    if (typeof x === 'number' && typeof y === 'number') {
      return (x - y) * sign;
    }
    return String(x).localeCompare(String(y)) * sign;
  });
}

/**
 * One CSV field. Quoted when needed (RFC 4180). Text starting with `= + - @` or a tab / CR is
 * prefixed with `'` so a spreadsheet opening the file never runs a log value as a formula (CSV
 * injection); real numbers are written as numbers.
 */
export function csvField(v: InspectorCell | string): string {
  if (v === null || v === undefined) {
    return '';
  }
  if (typeof v === 'number') {
    return Number.isFinite(v) ? String(v) : '';
  }
  let s = v;
  if (/^[=+\-@\t\r]/.test(s)) {
    s = `'${s}`;
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The table as CSV: `formatted` writes the cells as shown (dates, grouped numbers), raw as returned. */
export function toCsv(table: InspectorTable, formatted: boolean): string {
  const lines = [table.columns.map((c) => csvField(c.label)).join(',')];
  for (const row of table.rows) {
    lines.push(
      row
        .map((cell, i) => {
          const col = table.columns[i];
          if (!formatted || !col) {
            return csvField(cell);
          }
          return csvField(cell === null || cell === undefined ? null : formatCell(col, cell));
        })
        .join(',')
    );
  }
  return lines.join('\r\n') + '\r\n';
}

/** File name for a CSV download: the chart title, made safe for every OS. */
export function csvFileName(title: string, formatted: boolean, now = new Date()): string {
  const base =
    title
      .replace(/[^\w.-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80) || 'visualization';
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${base}-${formatted ? 'formatted' : 'raw'}-${stamp}.csv`;
}

/** Visualize's chart queries: the tracer roots for op 'lens', newest last. */
export function lensRequests(roots: readonly Span[]): Span[] {
  return roots.filter((r) => r.kind === 'lens');
}

/** Wall-clock time of a tracer timestamp (tracer times are `performance.now()` based). */
export function spanWallTime(ms: number): Date {
  const origin = typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin : 0;
  return new Date(origin + ms);
}

const BREAK_BEFORE = /^(SELECT|FROM|WHERE|GROUP BY|ORDER BY|HAVING|LIMIT|UNION ALL|ARRAY JOIN|LEFT ARRAY JOIN|LEFT JOIN|INNER JOIN|JOIN|PREWHERE|SETTINGS|WITH)\b/i;

/**
 * A readable layout of generated SQL: a line break before each clause keyword (indented by the
 * parenthesis depth), strings and quoted identifiers left alone. Text only, never executed.
 */
export function prettySql(sql: string): string {
  let out = '';
  let depth = 0;
  let i = 0;
  const flat = sql.replace(/\s+/g, ' ').trim();
  while (i < flat.length) {
    const c = flat[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < flat.length && flat[j] !== c) {
        j += flat[j] === '\\' ? 2 : 1;
      }
      out += flat.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '(') {
      depth++;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
    }
    const prev = flat[i - 1];
    if (i > 0 && (prev === ' ' || prev === '(') && BREAK_BEFORE.test(flat.slice(i)) && /[A-Za-z]/.test(c)) {
      out = out.replace(/ $/, '') + '\n' + '  '.repeat(depth);
    }
    out += c;
    i++;
  }
  return out;
}
