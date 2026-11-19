/**
 * Lens chart → Grafana dashboard panel (spec LENS-SAVE-01).
 *
 * The panel runs the same compiled Lens SQL on the ClickHouse datasource (dashboard mode: time
 * macros, so it follows the dashboard's time picker) and reshapes the long rows with standard
 * transformations into what the matching core panel draws. Pure: unit-tested on the JSON.
 */
import { TimeRange } from '@grafana/data';
import { chDatasourceRef, ExportedPanel, FORMAT_TABLE, GridPos } from '../data/panelExport';
import { SourceConfig } from '../types';
import { bucketAlias, compileLens, metricAlias, uniqueMetricLabels } from './compile';
import { dimLabelIn, LensState } from './state';
import { chartTitle } from './suggest';
import { withMetricAppearance } from './render/fieldConfig';
import { tableOverrides } from './tableChart';
import { autoAxisTitles, withLensStyle } from './render/styleConfig';
import { withReferenceThresholds } from './render/layerConfig';

export interface LensPanelOpts {
  id: number;
  gridPos: GridPos;
  title?: string;
  description?: string;
}

export interface LensPanel extends ExportedPanel {
  description?: string;
}

type Transformation = NonNullable<ExportedPanel['transformations']>[number];

const LEGEND = { showLegend: true, displayMode: 'list', placement: 'bottom', calcs: [] };

function stackingOf(state: LensState): 'normal' | 'percent' | 'none' {
  if (state.subType === 'percentage') {
    return 'percent';
  }
  return state.subType === 'stacked' && state.chartType !== 'line' ? 'normal' : 'none';
}

/** Readable column names for the SQL aliases (b0 → "Top 9 values of ServiceName", m0 → "Count of records"). */
export function columnNames(state: LensState): Record<string, string> {
  const names: Record<string, string> = {};
  state.buckets.forEach((b, i) => (names[bucketAlias(i)] = dimLabelIn(b, state.metrics)));
  uniqueMetricLabels(state.metrics).forEach((l, i) => (names[metricAlias(i)] = l));
  return names;
}

/** Suggested title: "Count of records by ServiceName over time". */
export function defaultPanelTitle(state: LensState): string {
  const metric = uniqueMetricLabels(state.metrics)[0] ?? chartTitle(state);
  const terms = state.buckets.filter((b) => b.kind === 'terms').map((b) => b.label);
  const time = state.buckets.some((b) => b.kind === 'date_histogram');
  return `${metric}${terms.length ? ` by ${terms.join(' and ')}` : ''}${time ? ' over time' : ''}`;
}

function rename(names: Record<string, string>): Transformation {
  return { id: 'organize', options: { renameByName: names, excludeByName: {}, indexByName: {} } };
}

export function buildLensPanel(
  state: LensState,
  config: SourceConfig,
  conditions: string[],
  timeRange: TimeRange,
  opts: LensPanelOpts
): LensPanel {
  const panel = baseLensPanel(state, config, conditions, timeRange, opts);
  const xy = state.chartType === 'line' || state.chartType === 'area' || state.chartType === 'bar';
  if (!panel.fieldConfig) {
    return panel;
  }
  const fieldConfig = withMetricAppearance(panel.fieldConfig, state, xy);
  if (!xy || (panel.type !== 'timeseries' && panel.type !== 'barchart')) {
    return { ...panel, fieldConfig };
  }
  const styled = withLensStyle(
    { options: (panel.options ?? {}) as Record<string, unknown>, fieldConfig },
    state,
    panel.type,
    autoAxisTitles(state)
  );
  // Static reference lines → thresholds drawn as lines (LENS-LAYER-01); annotations aren't exported.
  return { ...panel, ...withReferenceThresholds(styled, state) };
}

function baseLensPanel(
  state: LensState,
  config: SourceConfig,
  conditions: string[],
  timeRange: TimeRange,
  opts: LensPanelOpts
): LensPanel {
  const datasource = chDatasourceRef(config.datasourceUid);
  const { sql } = compileLens(state, config, conditions, timeRange, 'dashboard');
  const names = columnNames(state);
  const [x, split] = state.buckets;
  const stacking = stackingOf(state);
  // Everything renamed except the split column, which the partition / pivot transformations read.
  const withoutSplit = Object.fromEntries(Object.entries(names).filter(([k]) => k !== bucketAlias(1)));
  const base = {
    id: opts.id,
    title: opts.title?.trim() || chartTitle(state),
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
    gridPos: opts.gridPos,
    datasource,
    targets: [{ refId: 'A', datasource, editorType: 'sql' as const, format: FORMAT_TABLE, rawSql: sql }],
  };

  switch (state.chartType) {
    case 'line':
    case 'area':
    case 'bar': {
      const custom =
        state.chartType === 'bar'
          ? { fillOpacity: 80, lineWidth: 0 }
          : { fillOpacity: state.chartType === 'area' ? 50 : 0, lineWidth: 2 };
      if (x?.kind === 'date_histogram') {
        // Long rows (time, split value, metrics) → one series per split value.
        const transformations: Transformation[] =
          split && split.kind !== 'date_histogram'
            ? [
                rename(withoutSplit),
                { id: 'partitionByValues', options: { fields: [bucketAlias(1)], keepFields: false } },
                { id: 'prepareTimeSeries', options: { format: 'many' } },
              ]
            : [rename(names)];
        return {
          ...base,
          type: 'timeseries',
          transformations,
          options: { legend: LEGEND, tooltip: { mode: 'multi', sort: 'desc' } },
          fieldConfig: {
            defaults: {
              custom: {
                ...custom,
                drawStyle: state.chartType === 'bar' ? 'bars' : 'line',
                showPoints: 'never',
                stacking: { mode: stacking, group: 'A' },
              },
            },
            overrides: [],
          },
        };
      }
      // Category X: a breakdown becomes one column per split value.
      const transformations: Transformation[] =
        !split || split.kind === 'date_histogram'
          ? [rename(names)]
          : state.metrics.length === 1
            ? [
                {
                  id: 'groupingToMatrix',
                  options: { columnField: bucketAlias(1), rowField: bucketAlias(0), valueField: metricAlias(0) },
                },
                rename({ [`${bucketAlias(0)}\\${bucketAlias(1)}`]: names[bucketAlias(0)] }),
              ]
            : [
                rename(withoutSplit),
                { id: 'partitionByValues', options: { fields: [bucketAlias(1)], keepFields: false } },
                { id: 'joinByField', options: { byField: names[bucketAlias(0)], mode: 'outer' } },
              ];
      return {
        ...base,
        type: 'barchart',
        transformations,
        options: {
          legend: LEGEND,
          stacking,
          xField: names[bucketAlias(0)],
          showValue: 'never',
          orientation: 'auto',
          xTickLabelRotation: 0,
        },
        fieldConfig: { defaults: { custom }, overrides: [] },
      };
    }
    case 'metric':
    case 'pie': {
      const byCategory = state.buckets.length > 0;
      return {
        ...base,
        type: state.chartType === 'pie' ? 'piechart' : 'stat',
        transformations: [rename(names)],
        options:
          state.chartType === 'pie'
            ? {
                legend: { ...LEGEND, placement: 'right', values: ['value'] },
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
    case 'table':
      // Summary row and colour by value carry over (LENS-CHART-01); a "Split metrics by" pivot is
      // not exported (one row per combination, as before).
      return {
        ...base,
        type: 'table',
        transformations: [rename(names)],
        options: { showHeader: true },
        fieldConfig: {
          defaults: {},
          overrides: tableOverrides(
            state.metrics.map((_, i) => ({
              name: names[metricAlias(i)],
              kind: 'number' as const,
              values: [],
              metricIndex: i,
            })),
            state.metrics
          ),
        },
      };
  }
}
