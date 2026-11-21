/**
 * Renders a Lens result with Grafana's own visualizations through `PanelRenderer` (blueprint:
 * "Lens renders with Grafana's own visualizations"). This file is the only place that knows about
 * PanelRenderer (marked @internal in @grafana/runtime), so an API change touches one adapter.
 */
import React, { useEffect, useRef, useState } from 'react';
import { css } from '@emotion/css';
import {
  createDataFrame,
  DataFrame,
  FieldConfigSource,
  createTheme,
  FieldType,
  getDefaultTimeRange,
  LoadingState,
  PanelData,
  TimeRange,
} from '@grafana/data';
import { PanelRenderer } from '@grafana/runtime';
import { LensResult } from '../compile';
import { LensState } from '../state';
import { seriesColorOf } from '../style';
import { stableColors, SESSION_COLOR_SLOTS } from './seriesColors';
import { XyChart, XySelection } from './XyChart';
import { withMetricAppearance } from './fieldConfig';
import { MetricTiles } from './MetricTiles';
import { tableColumns, tableOverrides } from '../tableChart';
import { autoAxisTitles, withLensStyle } from './styleConfig';
import { LayerData, resolveLayers } from '../layers';
import { withReferenceThresholds } from './layerConfig';

interface PanelSpec {
  pluginId: string;
  frames: DataFrame[];
  options: Record<string, unknown>;
  fieldConfig: { defaults: Record<string, unknown>; overrides: unknown[] };
}

const legend = { showLegend: true, displayMode: 'list', placement: 'bottom', calcs: [] };

function numberFields(result: LensResult) {
  return result.series.map((s) => ({
    name: s.name,
    type: FieldType.number,
    // A missing time bucket is 0 only for counts; other metrics (and calculations) have no value there.
    values: result.xs.map((x) => s.points.get(x) ?? (result.xIsTime && s.zeroFill ? 0 : null)),
  }));
}

/** Chart type + shaped rows → the Grafana panel that draws them, with the metrics' appearance. */
export function panelSpec(state: LensState, result: LensResult): PanelSpec {
  const spec = basePanelSpec(state, result);
  const xy = state.chartType === 'line' || state.chartType === 'area' || state.chartType === 'bar';
  const fieldConfig = withMetricAppearance(spec.fieldConfig, state, xy) as PanelSpec['fieldConfig'];
  if (!xy) {
    return { ...spec, fieldConfig };
  }
  const styled = withLensStyle(
    { options: spec.options, fieldConfig },
    state,
    spec.pluginId === 'barchart' ? 'barchart' : 'timeseries',
    autoAxisTitles(state)
  );
  return { ...spec, ...withReferenceThresholds(styled, state) };
}

function basePanelSpec(state: LensState, result: LensResult): PanelSpec {
  // Line has no stacking (Kibana); a sub-type kept from Bar / Area doesn't apply to it.
  const stacking =
    state.chartType === 'line'
      ? 'none'
      : state.subType === 'percentage'
        ? 'percent'
        : state.subType === 'stacked'
          ? 'normal'
          : 'none';
  switch (state.chartType) {
    case 'line':
    case 'area':
    case 'bar':
      if (result.xIsTime) {
        return {
          pluginId: 'timeseries',
          frames: [
            createDataFrame({
              fields: [{ name: 'time', type: FieldType.time, values: result.xs }, ...numberFields(result)],
            }),
          ],
          options: { legend, tooltip: { mode: 'multi', sort: 'desc' } },
          fieldConfig: {
            defaults: {
              custom: {
                drawStyle: state.chartType === 'bar' ? 'bars' : 'line',
                fillOpacity: state.chartType === 'area' ? 50 : state.chartType === 'bar' ? 80 : 0,
                lineWidth: state.chartType === 'bar' ? 0 : 2,
                showPoints: 'never',
                stacking: { mode: stacking, group: 'A' },
              },
            },
            overrides: [],
          },
        };
      }
      return {
        pluginId: 'barchart',
        frames: [
          createDataFrame({
            fields: [{ name: 'x', type: FieldType.string, values: result.xLabels }, ...numberFields(result)],
          }),
        ],
        options: { legend, stacking, xField: 'x', showValue: 'never', orientation: 'auto', xTickLabelRotation: 0 },
        fieldConfig: { defaults: { custom: { fillOpacity: 80, lineWidth: 0 } }, overrides: [] },
      };
    case 'pie':
      if (result.xs.length > 0 && result.xs[0] !== '' && result.series.length === 1) {
        return pieSpec(state, result);
      }
    // falls through (no categories: the same panel as the Metric chart)
    case 'metric': {
      const byCategory = result.xs.length > 0 && result.xs[0] !== '';
      const fields = byCategory
        ? [{ name: 'category', type: FieldType.string, values: result.xLabels }, ...numberFields(result)]
        : numberFields(result);
      return {
        pluginId: state.chartType === 'pie' ? 'piechart' : 'stat',
        frames: [createDataFrame({ fields })],
        options:
          state.chartType === 'pie'
            ? {
                legend: { ...legend, placement: 'right', values: ['value', 'percent'] },
                reduceOptions: { values: true, calcs: [], fields: '' },
                pieType: 'pie',
              }
            : {
                reduceOptions: { values: byCategory, calcs: ['lastNotNull'], fields: '' },
                textMode: byCategory ? 'value_and_name' : 'auto',
                colorMode: 'none',
                graphMode: 'none',
                justifyMode: 'auto',
              },
        fieldConfig: { defaults: {}, overrides: [] },
      };
    }
    case 'table': {
      // Rows / Split metrics by / Metrics, summary row and colour by value (LENS-CHART-01).
      const columns = tableColumns(state, result.table);
      const fields = columns.map((c) => ({
        name: c.name,
        type: c.kind === 'time' ? FieldType.time : c.kind === 'number' ? FieldType.number : FieldType.string,
        values: c.values,
      }));
      return {
        pluginId: 'table',
        frames: [createDataFrame({ fields })],
        options: { showHeader: true },
        // Thousands separators (a metric's own value format overrides) and wrapped, not truncated, headers.
        fieldConfig: {
          defaults: { unit: 'locale', custom: { wrapHeaderText: true } },
          overrides: tableOverrides(columns, state.metrics),
        },
      };
    }
  }
}

/** Slices under this share of the total are too narrow for an on-slice label (they overlap). */
export const PIE_LABEL_MIN_SHARE = 0.05;

/**
 * On-slice labels for a pie. Grafana's piechart has one panel-wide `displayLabels` list, no per-slice
 * switch, no rotation and no decimals for the percent, so when any slice is too small for its label
 * ("warn 8%" over "debug 6%") the labels are dropped for the whole pie and the legend (value and percent)
 * carries the numbers instead.
 */
export function pieDisplayLabels(values: number[]): Array<'name' | 'percent'> {
  const total = values.reduce((a, v) => a + Math.max(0, v), 0);
  const crowded = values.some((v) => total > 0 && v > 0 && v / total < PIE_LABEL_MIN_SHARE);
  return crowded ? [] : ['name', 'percent'];
}

/**
 * Pie: one field per slice, so each slice has its own colour — the value's stable colour (the same
 * as in the XY chart), or a legend pick — and labels read "name NN%"; legend values are grouped.
 */
function pieSpec(state: LensState, result: LensResult): PanelSpec {
  const theme = createTheme();
  const series = result.series[0];
  const names = result.xLabels.map((l, i) => l ?? String(result.xs[i]));
  const colors = stableColors(
    names,
    result.xSynthetic,
    theme.visualization.palette,
    (n) => theme.visualization.getColorByName(n),
    (n) => seriesColorOf(state.style, n),
    SESSION_COLOR_SLOTS
  );
  const fields = names.map((name, i) => ({
    name,
    type: FieldType.number,
    values: [series.points.get(result.xs[i]) ?? 0],
    config: { color: { mode: 'fixed', fixedColor: colors[i] } },
  }));
  return {
    pluginId: 'piechart',
    frames: [createDataFrame({ fields })],
    options: {
      legend: { ...legend, placement: 'right', values: ['value', 'percent'] },
      reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' },
      pieType: 'pie',
      displayLabels: pieDisplayLabels(fields.map((f) => f.values[0])),
      tooltip: { mode: 'single', sort: 'none' },
    },
    // Thousands separators unless the metric has its own value format (applied after this).
    fieldConfig: { defaults: { unit: 'locale' }, overrides: [] },
  };
}

interface Props {
  state: LensState;
  result: LensResult;
  timeRange: TimeRange;
  onChangeTimeRange?: (from: number, to: number) => void;
  /** Width of one date bucket (ms), for the brush. */
  bucketMs?: number;
  /** One click on a bar segment / point (XY charts, LENS-INTERACT-01). */
  onSelect?: (sel: XySelection) => void;
  onLegendFilter?: (seriesIndex: number, mode: 'for' | 'out') => void;
  /** Computed reference values and query annotation events (LENS-LAYER-01). */
  layerData?: LayerData;
  /** Legend ⋮ → colour (XY charts); undefined resets the series to its automatic colour. */
  onSeriesColor?: (seriesName: string, color: string | undefined) => void;
}

export function LensChart({
  state,
  result,
  timeRange,
  onChangeTimeRange,
  bucketMs,
  onSelect,
  onLegendFilter,
  layerData,
  onSeriesColor,
}: Props) {
  if (state.chartType === 'bar' || state.chartType === 'line' || state.chartType === 'area') {
    // Custom-drawn so one click can filter (PanelRenderer has no point-click callback).
    return (
      <div className={styles.box} data-testid="lens-chart" data-chart-type={state.chartType} data-panel="xy">
        <XyChart
          chartType={state.chartType}
          subType={state.subType}
          result={result}
          bucketMs={bucketMs}
          onSelect={onSelect}
          onBrush={onChangeTimeRange}
          onLegendFilter={onLegendFilter}
          metrics={state.metrics}
          style={state.style}
          axisTitles={autoAxisTitles(state)}
          layers={state.layers ? resolveLayers(state.layers, layerData) : undefined}
          timeRange={timeRange ? { from: timeRange.from.valueOf(), to: timeRange.to.valueOf() } : undefined}
          onSeriesColor={onSeriesColor}
        />
      </div>
    );
  }
  if (state.chartType === 'metric') {
    // Tiles drawn here: secondary metric, maximum-value progress bar (LENS-CHART-01).
    return (
      <div className={styles.box} data-testid="lens-chart" data-chart-type="metric" data-panel="tiles">
        <MetricTiles state={state} result={result} />
      </div>
    );
  }
  return <PanelChart state={state} result={result} timeRange={timeRange} />;
}

/** Metric / Table / Pie through Grafana's own panels. */
function PanelChart({ state, result, timeRange }: { state: LensState; result: LensResult; timeRange: TimeRange }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(([entry]) => {
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const spec = panelSpec(state, result);
  const data: PanelData = {
    state: LoadingState.Done,
    series: spec.frames,
    timeRange: timeRange ?? getDefaultTimeRange(),
  };
  return (
    <div
      ref={ref}
      className={styles.box}
      data-testid="lens-chart"
      data-chart-type={state.chartType}
      data-panel={spec.pluginId}
    >
      {size.width > 0 && size.height > 0 && (
        <PanelRenderer
          title=""
          pluginId={spec.pluginId}
          width={size.width}
          height={size.height}
          data={data}
          options={spec.options}
          fieldConfig={spec.fieldConfig as FieldConfigSource}
          timeZone="browser"
        />
      )}
    </div>
  );
}

const styles = {
  box: css`
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 240px;
  `,
};
