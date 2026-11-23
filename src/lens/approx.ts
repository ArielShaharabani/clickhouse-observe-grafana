import type { LensState, MetricDim } from './state';
import { formulaAggs } from './formula';
import { computedLines } from './layers';

/**
 * SHARED-PERF-01 honesty cue for Visualize: which parts of the chart are estimates rather than
 * exact numbers. Unique count compiles to ClickHouse `uniq` (adaptive sampling, approximate above
 * ~65k distinct values), median and percentile to `quantile` (a sample of 8,192 values). Looks at
 * the metrics, what calculations and formulas are computed over, and computed reference lines.
 * Returns null when every number is exact.
 */
export function lensApproxNote(state: Pick<LensState, 'metrics'> & Pick<Partial<LensState>, 'layers'>): string | null {
  const ops = [
    ...state.metrics.flatMap(opsOf),
    ...computedLines(state.layers).map((l) => l.computed.op as string),
  ];
  const notes = [
    ops.some((o) => o === 'unique' || o === 'unique_count') ? 'Unique counts are approximate (ClickHouse uniq).' : '',
    ops.some((o) => o === 'median' || o === 'percentile')
      ? 'Medians and percentiles are estimates (ClickHouse quantile, from a sample of the values).'
      : '',
  ].filter(Boolean);
  return notes.length > 0 ? notes.join(' ') : null;
}

const opsOf = (m: MetricDim): string[] =>
  m.op === 'formula' ? formulaAggs(m.formula ?? '') : [m.op, ...(m.ref ? [m.ref.op] : [])];
