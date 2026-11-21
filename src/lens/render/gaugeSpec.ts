/**
 * Gauge (R3-CHARTS): one value against a range, drawn by Grafana's `gauge` (arc) or `bargauge`
 * (horizontal bar). Shared by Visualize (PanelRenderer, the rows already shaped) and the dashboard
 * export (same options and field config; the export reshapes the SQL rows with transformations).
 */
import { createDataFrame, createTheme, DataFrame, FieldType } from '@grafana/data';
import { LensResult } from '../compile';
import { grafanaUnit } from '../metricOptions';
import { GaugeOptions, LensState, MAX_GAUGES } from '../state';

/** A round number at or above `v` (1, 2, 2.5, 5 × 10^k): the automatic maximum. */
export function niceCeil(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) {
    return 1;
  }
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((k) => k * p >= v * (1 - 1e-12)) ?? 10;
  return m * p;
}

/** Colour bands: green / amber / red at 70 % and 90 % of the range, mirrored when high is good. */
export function gaugeThresholds(bands: GaugeOptions['bands'], color: string) {
  const theme = createTheme();
  const c = (n: string) => theme.visualization.getColorByName(n);
  if (!bands) {
    return { mode: 'absolute', steps: [{ color, value: null }] };
  }
  const [lowC, highC] = bands === 'low' ? [c('green'), c('red')] : [c('red'), c('green')];
  return {
    mode: 'percentage',
    steps: [
      { color: lowC, value: null },
      { color: c('orange'), value: 70 },
      { color: highC, value: 90 },
    ],
  };
}

/** Indexes of the gauge's value metric and of its "Maximum value" metric (-1 when none). */
export function gaugeMetrics(state: LensState): { value: number; max: number } {
  const value = state.metrics.findIndex((m) => m.role !== 'max');
  return { value, max: state.metrics.findIndex((m) => m.role === 'max') };
}

/** Grafana panel options for the gauge's shape. */
export function gaugeOptions(state: LensState): { pluginId: 'gauge' | 'bargauge'; options: Record<string, unknown> } {
  const reduceOptions = { values: false, calcs: ['lastNotNull'], fields: '' };
  if (state.gauge?.shape === 'bar') {
    return {
      pluginId: 'bargauge',
      options: {
        reduceOptions,
        orientation: 'horizontal',
        displayMode: 'basic',
        valueMode: 'color',
        namePlacement: 'top',
        showUnfilled: true,
        // One bar per Break down by value at a readable height; a lone bar fills the panel.
        ...(state.buckets.length > 0 ? { sizing: 'manual', minVizHeight: 24, maxVizHeight: 28 } : { sizing: 'auto' }),
        text: { titleSize: 13, valueSize: 20 },
      },
    };
  }
  return {
    pluginId: 'gauge',
    options: {
      reduceOptions,
      orientation: 'auto',
      showThresholdMarkers: !!state.gauge?.bands,
      showThresholdLabels: false,
      sizing: 'auto',
      minVizWidth: 75,
      minVizHeight: 75,
      text: { titleSize: 13 },
    },
  };
}

/** Field config defaults shared by every gauge: unit / decimals of the metric, min, colour. */
export function gaugeDefaults(state: LensState): Record<string, unknown> {
  const theme = createTheme();
  const { value } = gaugeMetrics(state);
  const m = state.metrics[value];
  const { unit, decimals } = grafanaUnit(m?.format);
  const color = m?.color ?? theme.visualization.getColorByName('blue');
  return {
    unit: unit ?? 'locale',
    ...(decimals !== undefined ? { decimals } : {}),
    min: state.gauge?.min ?? 0,
    color: { mode: 'thresholds' },
    thresholds: gaugeThresholds(state.gauge?.bands, color),
  };
}

/**
 * The maximum of each gauge: its "Maximum value" metric, else the typed maximum, else a round
 * number above the largest value (shared by all gauges, so they compare).
 */
export function gaugeMaxes(state: LensState, values: number[], maxValues: Array<number | null>): number[] {
  const min = state.gauge?.min ?? 0;
  const typed = state.gauge?.max;
  const auto = niceCeil(Math.max(min + 1e-9, ...values.map((v) => (Number.isFinite(v) ? v : 0))) - min) + min;
  return values.map((_v, i) => {
    const own = maxValues[i];
    if (own !== null && own !== undefined && own > min) {
      return own;
    }
    return typed !== undefined && typed > min ? typed : auto;
  });
}

/** The automatic maximum of a gauge chart's current rows (what Visualize draws without a max). */
export function gaugeAutoMax(state: LensState, result: LensResult): number {
  const max = gaugeSpec({ ...state, gauge: { ...state.gauge, max: undefined } }, result).frames[0]?.fields[0]?.config
    .max;
  return typeof max === 'number' ? max : 1;
}

export interface GaugeSpec {
  pluginId: 'gauge' | 'bargauge';
  frames: DataFrame[];
  options: Record<string, unknown>;
  fieldConfig: { defaults: Record<string, unknown>; overrides: unknown[] };
  /** Values beyond MAX_GAUGES that are not drawn. */
  hidden: number;
}

/** Visualize: one field per gauge (Break down by value), each with its own maximum. */
export function gaugeSpec(state: LensState, result: LensResult): GaugeSpec {
  const { value, max } = gaugeMetrics(state);
  const byCategory = result.xs.length > 0 && result.xs[0] !== '';
  const valueSeries = result.series.find((s) => s.metricIndex === value);
  const maxSeries = max >= 0 ? result.series.find((s) => s.metricIndex === max) : undefined;
  const xs = result.xs.slice(0, MAX_GAUGES);
  const values = xs.map((x) => valueSeries?.points.get(x) ?? 0);
  const maxes = gaugeMaxes(
    state,
    values,
    xs.map((x) => maxSeries?.points.get(x) ?? null)
  );
  const fields = xs.map((x, i) => ({
    name: byCategory ? (result.xLabels[i] ?? String(x)) || '(empty)' : (valueSeries?.name ?? 'Value'),
    type: FieldType.number,
    values: [values[i]],
    config: { max: maxes[i] },
  }));
  const { pluginId, options } = gaugeOptions(state);
  return {
    pluginId,
    frames: [createDataFrame({ fields })],
    options,
    fieldConfig: { defaults: gaugeDefaults(state), overrides: [] },
    hidden: Math.max(0, result.xs.length - MAX_GAUGES),
  };
}
