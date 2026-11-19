/**
 * Metric Appearance options (LENS-DIM-02: value format, series colour, axis side) as Grafana field
 * config, for the panels Lens renders through PanelRenderer and for exported dashboard panels.
 * One metric → field defaults; several → one override per metric, matched by its label.
 */
import { uniqueMetricLabels } from '../compile';
import { grafanaUnit } from '../metricOptions';
import { LensState, MetricDim } from '../state';

export interface LensFieldConfig {
  defaults: Record<string, unknown>;
  overrides: unknown[];
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function properties(m: MetricDim, state: LensState, xy: boolean): Array<{ id: string; value: unknown }> {
  const props: Array<{ id: string; value: unknown }> = [];
  const { unit, decimals } = grafanaUnit(m.format);
  if (unit) {
    props.push({ id: 'unit', value: unit });
  }
  if (decimals !== undefined) {
    props.push({ id: 'decimals', value: decimals });
  }
  // A breakdown gives each value its own colour (as in Kibana), so a metric colour only applies without one.
  const breakdown = state.chartType === 'pie' || (xy && state.buckets.length > 1);
  if (m.color && !breakdown) {
    props.push({ id: 'color', value: { mode: 'fixed', fixedColor: m.color } });
  }
  if (xy && m.axis) {
    props.push({ id: 'custom.axisPlacement', value: m.axis });
  }
  return props;
}

/**
 * Field config with the metrics' appearance options merged in. `matcherFor` picks the override
 * matcher of metric `i` when there are several (default: its label, as displayed in Visualize).
 */
export function withMetricAppearance(
  base: LensFieldConfig,
  state: LensState,
  xy: boolean,
  matcherFor?: (i: number) => { id: string; options: string }
): LensFieldConfig {
  const perMetric = state.metrics.map((m) => properties(m, state, xy));
  if (perMetric.every((p) => p.length === 0)) {
    return base;
  }
  if (state.metrics.length === 1) {
    const defaults: Record<string, unknown> = { ...base.defaults };
    for (const { id, value } of perMetric[0]) {
      if (id.startsWith('custom.')) {
        defaults.custom = { ...(defaults.custom as Record<string, unknown> | undefined), [id.slice(7)]: value };
      } else {
        defaults[id] = value;
      }
    }
    return { defaults, overrides: base.overrides };
  }
  const labels = uniqueMetricLabels(state.metrics);
  const overrides = perMetric.flatMap((props, i) =>
    props.length === 0
      ? []
      : [
          {
            matcher: matcherFor?.(i) ?? { id: 'byRegexp', options: `^(.* · )?${escapeRegex(labels[i])}$` },
            properties: props,
          },
        ]
  );
  return { defaults: base.defaults, overrides: [...base.overrides, ...overrides] };
}
