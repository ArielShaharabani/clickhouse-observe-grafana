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
import { dimLabelIn, LensState, MAX_GAUGES } from '../state';
import { isPieLike } from '../suggest';
import { gaugeSpec } from './gaugeSpec';
import { HeatmapChart } from './HeatmapChart';
import { seriesColorOf } from '../style';
import { stableColors, SESSION_COLOR_SLOTS } from './seriesColors';
import { XyChart, XySelection } from './XyChart';
import { withMetricAppearance } from './fieldConfig';
import { MetricTiles } from './MetricTiles';
import { PieChart } from './PieChart';
import { tableColumns, tableOverrides } from '../tableChart';
import { autoAxisTitles, withLensStyle } from './styleConfig';
import { LayerData, resolveLayers } from '../layers';
import { withReferenceThresholds } from './layerConfig';
import { useTimeZoneSettings } from '../../utils/timeZone';

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
  if (state.chartType === 'gauge') {
    // Unit, decimals and colour are already in the gauge's field config (colour bands win).
    return spec;
  }
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
    case 'gauge':
      return gaugeSpec(state, result);
    case 'heatmap':
      // Drawn by HeatmapChart in Visualize; as a table of colour-coded rows here (a fallback only).
      return { ...basePanelSpec({ ...state, chartType: 'table' }, result) };
    case 'pie':
    case 'donut':
      if (hasSlices(result)) {
        return pieSpec(state, result);
      }
    // falls through (no categories: the same panel as the Metric chart)
    case 'metric': {
      const byCategory = result.xs.length > 0 && result.xs[0] !== '';
      const fields = byCategory
        ? [{ name: 'category', type: FieldType.string, values: result.xLabels }, ...numberFields(result)]
        : numberFields(result);
      return {
        pluginId: isPieLike(state.chartType) ? 'piechart' : 'stat',
        frames: [createDataFrame({ fields })],
        options: isPieLike(state.chartType)
          ? {
              legend: { ...legend, placement: 'right', values: ['value', 'percent'] },
              reduceOptions: { values: true, calcs: [], fields: '' },
              pieType: state.chartType === 'donut' ? 'donut' : 'pie',
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
        options: { showHeader: true, enablePagination: true },
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

/** Whether a pie / donut has slices to draw (one metric over categories). */
const hasSlices = (result: LensResult) => result.xs.length > 0 && result.xs[0] !== '' && result.series.length === 1;

/** Slice names, values and colours: the value's stable colour (as in the XY chart) or a legend pick. */
function pieData(state: LensState, result: LensResult): { names: string[]; values: number[]; colors: string[] } {
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
  return { names, values: names.map((_, i) => series.points.get(result.xs[i]) ?? 0), colors };
}

/**
 * Pie: one field per slice, so each slice has its own colour — the value's stable colour (the same
 * as in the XY chart), or a legend pick — and labels read "name NN%"; legend values are grouped.
 */
function pieSpec(state: LensState, result: LensResult): PanelSpec {
  const { names, values, colors } = pieData(state, result);
  const fields = names.map((name, i) => ({
    name,
    type: FieldType.number,
    values: [values[i]],
    config: { color: { mode: 'fixed', fixedColor: colors[i] } },
  }));
  return {
    pluginId: 'piechart',
    frames: [createDataFrame({ fields })],
    options: {
      legend: { ...legend, placement: 'right', values: ['value', 'percent'] },
      reduceOptions: { values: false, calcs: ['lastNotNull'], fields: '' },
      pieType: state.chartType === 'donut' ? 'donut' : 'pie',
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
  if (state.chartType === 'heatmap') {
    const y = state.buckets[1];
    return (
      <div className={styles.box} data-testid="lens-chart" data-chart-type="heatmap" data-panel="heatmap">
        <HeatmapChart
          result={result}
          metric={state.metrics[0]}
          yTitle={y ? dimLabelIn(y, state.metrics) : ''}
          metricLabel={state.metrics[0] ? dimLabelIn(state.metrics[0], state.metrics) : undefined}
          bucketMs={bucketMs}
          onSelect={onSelect}
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
  if (isPieLike(state.chartType) && hasSlices(result)) {
    // Custom-drawn: Kibana-like labels (decimals, inside or outside, no overlap) and click to filter.
    const { names, values, colors } = pieData(state, result);
    return (
      <div className={styles.box} data-testid="lens-chart" data-chart-type={state.chartType} data-panel="pie">
        <PieChart
          names={names}
          values={values}
          colors={colors}
          donut={state.chartType === 'donut'}
          metric={state.metrics[0]}
          metricLabel={state.metrics[0] ? dimLabelIn(state.metrics[0], state.metrics) : undefined}
          onSelect={onSelect}
        />
      </div>
    );
  }
  if (state.chartType === 'gauge' && state.gauge?.shape !== 'bar') {
    return <GaugeGrid state={state} result={result} timeRange={timeRange} />;
  }
  return <PanelChart state={state} result={result} timeRange={timeRange} />;
}

/** Columns for `n` equal cells in a box, each as large as possible (an arc and its caption are about square). */
export function gaugeColumns(n: number, width: number, height: number): number {
  let best = 1;
  let bestSize = 0;
  for (let c = 1; c <= Math.max(1, n); c++) {
    const rows = Math.ceil(n / c);
    const size = Math.min(width / c, height / rows);
    if (size > bestSize + 0.5) {
      best = c;
      bestSize = size;
    }
  }
  return best;
}

/**
 * Arc gauges in an even grid, one Grafana gauge per cell: Grafana's own repeater grows the last
 * row's gauges to fill it, so the same value would look bigger there.
 */
function GaugeGrid({ state, result, timeRange }: { state: LensState; result: LensResult; timeRange: TimeRange }) {
  const { timeZone } = useTimeZoneSettings();
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
  const fields = spec.frames[0]?.fields ?? [];
  const hidden = Math.max(0, result.xs.length - MAX_GAUGES);
  const cols = gaugeColumns(fields.length, size.width, size.height - (hidden > 0 ? 18 : 0));
  const rows = Math.max(1, Math.ceil(fields.length / cols));
  const cw = Math.floor(size.width / cols);
  const ch = Math.floor((size.height - (hidden > 0 ? 18 : 0)) / rows);
  return (
    <div ref={ref} className={styles.box} data-testid="lens-chart" data-chart-type="gauge" data-panel="gauge">
      {hidden > 0 && (
        <div className={styles.note} data-testid="lens-gauge-note">
          Showing the first {MAX_GAUGES} values ({hidden} more not shown)
        </div>
      )}
      <div
        className={styles.gaugeGrid}
        style={{ gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gridTemplateRows: `repeat(${rows}, ${ch}px)` }}
      >
        {cw > 20 &&
          ch > 40 &&
          fields.map((f, i) => (
            <div
              key={`${i}:${f.name}`}
              className={styles.gaugeCell}
              role="img"
              aria-label={`${f.name}: ${f.values[0]}`}
              data-testid="lens-gauge"
            >
              <PanelRenderer
                title=""
                pluginId="gauge"
                width={cw}
                height={ch - (fields.length > 1 ? 22 : 0)}
                data={{
                  state: LoadingState.Done,
                  series: [createDataFrame({ fields: [f] })],
                  timeRange: timeRange ?? getDefaultTimeRange(),
                }}
                options={spec.options}
                fieldConfig={spec.fieldConfig as FieldConfigSource}
                timeZone={timeZone}
              />
              {/* Grafana hides a lone gauge's name: the value it is for goes underneath. */}
              {fields.length > 1 && (
                <div className={styles.gaugeName} title={f.name}>
                  {f.name}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

/** Metric / Table / Pie through Grafana's own panels. */
function PanelChart({ state, result, timeRange }: { state: LensState; result: LensResult; timeRange: TimeRange }) {
  const { timeZone } = useTimeZoneSettings();
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
  const hidden = state.chartType === 'gauge' ? Math.max(0, result.xs.length - MAX_GAUGES) : 0;
  const lone = state.chartType === 'gauge' && (spec.frames[0]?.fields.length ?? 0) === 1;
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
      {hidden > 0 && (
        <div className={styles.note} data-testid="lens-gauge-note">
          Showing the first {MAX_GAUGES} values ({hidden} more not shown)
        </div>
      )}
      {/* A lone bar gauge: a bullet-sized bar, centred, under its metric's name (as Kibana draws it). */}
      {lone && size.width > 0 && (
        <div className={styles.loneName} style={{ top: Math.max(0, size.height / 2 - 52) }}>
          {state.metrics[0]
            ? dimLabelIn(state.metrics.find((m) => m.role !== 'max') ?? state.metrics[0], state.metrics)
            : ''}
        </div>
      )}
      {size.width > 0 && size.height > 0 && (
        <div
          style={lone ? { position: 'absolute', left: 0, right: 0, top: Math.max(0, size.height / 2 - 28) } : undefined}
        >
          <PanelRenderer
            title=""
            pluginId={spec.pluginId}
            width={size.width}
            height={lone ? Math.min(size.height, 56) : size.height}
            data={data}
            options={spec.options}
            fieldConfig={spec.fieldConfig as FieldConfigSource}
            timeZone={timeZone}
          />
        </div>
      )}
    </div>
  );
}

const styles = {
  loneName: css`
    position: absolute;
    left: 4px;
    font-size: 14px;
    font-weight: 500;
  `,
  gaugeGrid: css`
    display: grid;
    width: 100%;
    height: 100%;
  `,
  gaugeCell: css`
    position: relative;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  `,
  gaugeName: css`
    text-align: center;
    font-size: 13px;
    line-height: 22px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 0 8px;
  `,
  note: css`
    position: absolute;
    right: 4px;
    bottom: 0;
    z-index: 1;
    font-size: 12px;
    opacity: 0.7;
  `,
  box: css`
    position: relative;
    width: 100%;
    height: 100%;
    min-height: 240px;
  `,
};
