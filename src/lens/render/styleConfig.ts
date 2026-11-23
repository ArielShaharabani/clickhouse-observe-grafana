/**
 * Style / Legend settings (LENS-STYLE-01) as Grafana panel options and field config, for exported
 * dashboard panels (and any XY chart drawn through PanelRenderer). Grafana's panels don't cover
 * every Lens option; the gaps degrade as documented in DECISIONS (legend top/left → bottom/right,
 * inside → bottom, grid → list; square-root scale → linear; per-axis tick / title settings on the
 * time axis are not configurable).
 */
import { uniqueMetricLabels } from '../compile';
import { sharesOneAxis } from './fieldConfig';
import { dimLabelIn, LensState } from '../state';
import { axisOf, axisTitle, legendOf, LensStyle, tickRotation } from '../style';

export interface PanelParts {
  options: Record<string, unknown>;
  fieldConfig: { defaults: Record<string, unknown>; overrides: unknown[] };
}

/** Grafana legend options for a style. */
export function legendOptions(style: LensStyle | undefined): Record<string, unknown> {
  const lg = legendOf(style);
  const placement =
    lg.position === 'outside' && (lg.alignment === 'right' || lg.alignment === 'left') ? 'right' : 'bottom';
  return { showLegend: lg.visibility !== 'hide', displayMode: 'list', placement, calcs: [] };
}

/**
 * Merges the chart's style into an XY panel (timeseries or barchart). `autoTitles` are the titles
 * the axes show when set to Auto (same as the in-app chart).
 */
export function withLensStyle(
  parts: PanelParts,
  state: LensState,
  panel: 'timeseries' | 'barchart',
  autoTitles: { left: string; bottom: string }
): PanelParts {
  const style = state.style;
  if (!style) {
    // Default bounds are Full (0 included): a Grafana time series would otherwise zoom to the data.
    const c = { ...(parts.fieldConfig.defaults.custom as Record<string, unknown>), axisSoftMin: 0 };
    return { options: parts.options, fieldConfig: { ...parts.fieldConfig, defaults: { ...parts.fieldConfig.defaults, custom: c } } };
  }
  const left = axisOf(style, 'left');
  const bottom = axisOf(style, 'bottom');
  const custom: Record<string, unknown> = { ...(parts.fieldConfig.defaults.custom as Record<string, unknown>) };
  const defaults: Record<string, unknown> = { ...parts.fieldConfig.defaults };

  const title = axisTitle(style, 'left', autoTitles.left);
  if (title) {
    custom.axisLabel = title;
  }
  custom.axisGridShow = left.gridlines;
  if (!left.ticks) {
    custom.axisPlacement = 'hidden';
  }
  if (left.scale === 'log') {
    custom.scaleDistribution = { type: 'log', log: 10 };
  }
  if (left.bounds === 'full') {
    // A log axis starts at 1 (a power of ten), as in Visualize; Grafana would pick the lowest value's decade.
    if (left.scale === 'log') {
      defaults.min = 1;
    } else {
      custom.axisSoftMin = 0;
    }
  } else if (left.bounds === 'custom') {
    if (left.min !== undefined) {
      defaults.min = left.min;
    }
    if (left.max !== undefined) {
      defaults.max = left.max;
    }
  }
  defaults.custom = custom;

  const options: Record<string, unknown> = { ...parts.options, legend: legendOptions(style) };
  if (panel === 'barchart') {
    options.orientation = style.orientation ?? 'auto';
    // Grafana prints a stacked bar's value on the next segment: no values rather than wrong ones.
    const stacked = parts.options.stacking === 'normal' || parts.options.stacking === 'percent';
    options.showValue = style.barValues === 'show' && !stacked ? 'auto' : 'never';
    options.xTickLabelRotation = tickRotation(bottom.orientation);
  }
  return { options, fieldConfig: { defaults, overrides: parts.fieldConfig.overrides } };
}

/**
 * Automatic axis titles (Axis title = Auto): the value axes name their metrics, the category axis
 * its bucket. Metrics set to the right axis title the right axis.
 */
export function autoAxisTitles(state: LensState): { left: string; bottom: string; right: string } {
  const labels = uniqueMetricLabels(state.metrics);
  const on = (sd: 'left' | 'right') =>
    labels.filter((_l, i) => (state.metrics[i].axis === 'right' && !sharesOneAxis(state) ? 'right' : 'left') === sd).join(', ');
  const x = state.buckets[0];
  // A time axis has no automatic title (Kibana: the dates are in the tick labels); Custom still applies.
  const bottom = !x || x.kind === 'date_histogram' ? '' : dimLabelIn(x, state.metrics);
  return { left: on('left'), right: on('right'), bottom };
}
