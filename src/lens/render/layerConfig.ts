/**
 * Reference line layers (LENS-LAYER-01) as Grafana thresholds, for exported dashboard panels.
 * Grafana's equivalent of a static reference line is a threshold step drawn as a line
 * (`custom.thresholdsStyle`); thresholds hold numbers and colours only, so what has no equivalent
 * degrades (documented in DECISIONS): labels are not shown, computed lines are not exported (a
 * threshold is a fixed value), right-axis lines are not exported when the chart has a right axis,
 * the line style is one per panel (dashed only when every line is dashed / dotted), and a fill is
 * kept only when every line fills above (Grafana's area mode colours the band above each step).
 * Annotations have no panel-level equivalent (Grafana annotations are dashboard queries / stored
 * events) and are not exported.
 */
import { LensState } from '../state';
import { DEFAULT_LINE_COLOR, ReferenceLine } from '../layers';
import { PanelParts } from './styleConfig';

/** The static lines an exported panel can draw as thresholds. */
export function exportableLines(state: LensState): ReferenceLine[] {
  const hasRight = state.metrics.some((m) => m.axis === 'right');
  return (state.layers ?? []).flatMap((l) =>
    l.kind === 'referenceLine' ? l.lines.filter((x) => !x.computed && !(hasRight && x.axis === 'right')) : []
  );
}

export function withReferenceThresholds(parts: PanelParts, state: LensState): PanelParts {
  const lines = exportableLines(state);
  if (lines.length === 0) {
    return parts;
  }
  const steps = [
    { color: 'transparent', value: null as number | null },
    ...[...lines]
      .sort((a, b) => a.value - b.value)
      .map((l) => ({ color: l.color ?? DEFAULT_LINE_COLOR, value: l.value })),
  ];
  const dashed = lines.every((l) => l.lineStyle === 'dashed' || l.lineStyle === 'dotted');
  const area = lines.every((l) => l.fill === 'above');
  const mode = `${dashed ? 'dashed' : 'line'}${area ? '+area' : ''}`;
  const defaults = parts.fieldConfig.defaults;
  return {
    options: parts.options,
    fieldConfig: {
      defaults: {
        ...defaults,
        thresholds: { mode: 'absolute', steps },
        custom: { ...(defaults.custom as Record<string, unknown>), thresholdsStyle: { mode } },
      },
      overrides: parts.fieldConfig.overrides,
    },
  };
}
