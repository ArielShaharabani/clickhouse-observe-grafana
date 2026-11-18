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
  FieldType,
  getDefaultTimeRange,
  LoadingState,
  PanelData,
  TimeRange,
} from '@grafana/data';
import { PanelRenderer } from '@grafana/runtime';
import { LensResult } from '../compile';
import { LensState } from '../state';
import { XyChart, XySelection } from './XyChart';

interface PanelSpec {
  pluginId: string;
  frames: DataFrame[];
  options: Record<string, unknown>;
  fieldConfig: { defaults: Record<string, unknown>; overrides: [] };
}

const legend = { showLegend: true, displayMode: 'list', placement: 'bottom', calcs: [] };

function numberFields(result: LensResult) {
  return result.series.map((s) => ({
    name: s.name,
    type: FieldType.number,
    values: result.xs.map((x) => s.points.get(x) ?? (result.xIsTime ? 0 : null)),
  }));
}

/** Chart type + shaped rows → the Grafana panel that draws them. Exported for tests. */
export function panelSpec(state: LensState, result: LensResult): PanelSpec {
  const stacking =
    state.subType === 'percentage'
      ? 'percent'
      : state.subType === 'stacked' && state.chartType !== 'line'
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
    case 'metric':
    case 'pie': {
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
                legend: { ...legend, placement: 'right', values: ['value'] },
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
      const { columns, rows } = result.table;
      const fields = columns.map((name, i) => {
        const isTime = state.buckets[i]?.kind === 'date_histogram';
        const isNum = i >= state.buckets.length;
        return {
          name,
          type: isTime ? FieldType.time : isNum ? FieldType.number : FieldType.string,
          values: rows.map((r) => r[i]),
        };
      });
      return {
        pluginId: 'table',
        frames: [createDataFrame({ fields })],
        options: { showHeader: true },
        fieldConfig: { defaults: {}, overrides: [] },
      };
    }
  }
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
}

export function LensChart({ state, result, timeRange, onChangeTimeRange, bucketMs, onSelect, onLegendFilter }: Props) {
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
        />
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
          fieldConfig={spec.fieldConfig}
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
