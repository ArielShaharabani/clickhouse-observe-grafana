/**
 * Table chart specifics (LENS-CHART-01, docs/spec/20-lens.md): "Split metrics by" pivots bucket
 * values into metric columns, and each metric column carries its summary row function and
 * colour-by-value option. Pure functions over the shaped result; no SQL here (the pivot only
 * reshapes the rows the normal Lens query already returns).
 */
import { LensState, MetricDim, TableSummary } from './state';

export type TableColumnKind = 'time' | 'string' | 'number';

export interface TableColumn {
  name: string;
  kind: TableColumnKind;
  values: Array<string | number | null>;
  /** Index into `state.metrics` for a metric column. */
  metricIndex?: number;
}

/** Separator between the pivot values and the metric name in a split column ("payments › Count"). */
export const PIVOT_SEP = ' › ';

/** Most pivot column groups kept (Kibana caps split columns too); the rest are dropped. */
export const MAX_PIVOT_COLUMNS = 100;

const cellKey = (v: string | number | null) => (v === null ? '\u0000null' : String(v));

/**
 * The table's columns: one per row bucket, then one per metric — or, with pivot buckets, one per
 * (pivot value combination × metric), in the order the combinations first appear.
 */
export function tableColumns(
  state: LensState,
  table: { columns: string[]; rows: Array<Array<string | number | null>> }
): TableColumn[] {
  const nb = state.buckets.length;
  const bucketKind = (i: number): TableColumnKind => (state.buckets[i]?.kind === 'date_histogram' ? 'time' : 'string');
  const rowIdx = state.buckets.map((b, i) => (b.pivot ? -1 : i)).filter((i) => i >= 0);
  const pivotIdx = state.buckets.map((b, i) => (b.pivot ? i : -1)).filter((i) => i >= 0);
  const metricIdx = state.metrics.map((_, i) => i);

  if (pivotIdx.length === 0) {
    return [
      ...rowIdx.map((i) => ({ name: table.columns[i], kind: bucketKind(i), values: table.rows.map((r) => r[i]) })),
      ...metricIdx.map((m) => ({
        name: table.columns[nb + m],
        kind: 'number' as const,
        values: table.rows.map((r) => r[nb + m]),
        metricIndex: m,
      })),
    ];
  }

  // Row key → output row; pivot key → column group.
  const rowOrder: string[] = [];
  const rowCells = new Map<string, Array<string | number | null>>();
  const groupOrder: string[] = [];
  const groupLabel = new Map<string, string>();
  const values = new Map<string, Map<string, Array<number | null>>>(); // row → group → metric values
  for (const r of table.rows) {
    const rk = rowIdx.map((i) => cellKey(r[i])).join('\u0001');
    const gk = pivotIdx.map((i) => cellKey(r[i])).join('\u0001');
    if (!rowCells.has(rk)) {
      rowOrder.push(rk);
      rowCells.set(
        rk,
        rowIdx.map((i) => r[i])
      );
    }
    if (!groupLabel.has(gk)) {
      if (groupOrder.length >= MAX_PIVOT_COLUMNS) {
        continue;
      }
      groupOrder.push(gk);
      groupLabel.set(gk, pivotIdx.map((i) => (r[i] === null ? '(empty)' : String(r[i]))).join(PIVOT_SEP));
    }
    let byGroup = values.get(rk);
    if (!byGroup) {
      byGroup = new Map();
      values.set(rk, byGroup);
    }
    byGroup.set(
      gk,
      metricIdx.map((m) => {
        const v = r[nb + m];
        return typeof v === 'number' ? v : v === null ? null : Number(v);
      })
    );
  }
  const cols: TableColumn[] = rowIdx.map((i, k) => ({
    name: table.columns[i],
    kind: bucketKind(i),
    values: rowOrder.map((rk) => rowCells.get(rk)![k]),
  }));
  for (const gk of groupOrder) {
    for (const m of metricIdx) {
      cols.push({
        name: `${groupLabel.get(gk)}${PIVOT_SEP}${table.columns[nb + m]}`,
        kind: 'number',
        // A row without that combination is empty, not 0 (it had no documents there).
        values: rowOrder.map((rk) => values.get(rk)?.get(gk)?.[m] ?? null),
        metricIndex: m,
      });
    }
  }
  return cols;
}

/** Grafana reducer id of a summary function. */
export const SUMMARY_REDUCERS: Record<TableSummary, string> = {
  sum: 'sum',
  avg: 'mean',
  count: 'count',
  min: 'min',
  max: 'max',
};

export const SUMMARY_LABELS: Record<TableSummary, string> = {
  sum: 'Sum',
  avg: 'Average',
  count: 'Value count',
  min: 'Minimum',
  max: 'Maximum',
};

/** Table field-config overrides for the metrics' summary row and colour-by-value, by column name. */
export function tableOverrides(columns: TableColumn[], metrics: MetricDim[]): unknown[] {
  const out: unknown[] = [];
  for (const c of columns) {
    const m = c.metricIndex === undefined ? undefined : metrics[c.metricIndex];
    if (!m) {
      continue;
    }
    const properties: Array<{ id: string; value: unknown }> = [];
    if (m.summary) {
      properties.push({ id: 'custom.footer', value: { reducers: [SUMMARY_REDUCERS[m.summary]] } });
    }
    if (m.colorBy) {
      properties.push({
        id: 'custom.cellOptions',
        value: m.colorBy === 'cell' ? { type: 'color-background', mode: 'gradient' } : { type: 'color-text' },
      });
      properties.push({ id: 'color', value: { mode: 'continuous-GrYlRd' } });
    }
    if (properties.length > 0) {
      out.push({ matcher: { id: 'byName', options: c.name }, properties });
    }
  }
  return out;
}
