import type { LensState } from './state';

/**
 * SHARED-PERF-01 honesty cue for Visualize: which parts of the chart are estimates rather than
 * exact counts. Unique count compiles to ClickHouse `uniq` (adaptive sampling, approximate above
 * ~65k distinct values). Returns null when every number is exact.
 */
export function lensApproxNote(state: Pick<LensState, 'metrics'>): string | null {
  return state.metrics.some((m) => m.op === 'unique')
    ? 'Unique counts are approximate (ClickHouse uniq).'
    : null;
}
