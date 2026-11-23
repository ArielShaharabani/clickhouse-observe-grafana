/**
 * Lens chart → Grafana dashboard panel (spec LENS-SAVE-01).
 *
 * The panel runs the same compiled Lens SQL on the ClickHouse datasource (dashboard mode: time
 * macros, so it follows the dashboard's time picker) and reshapes the long rows with standard
 * transformations into what the matching core panel draws. Pure: unit-tested on the JSON.
 */
import { createTheme, TimeRange } from '@grafana/data';
import { chDatasourceRef, EXPORT_VOLUME_POINTS, ExportedPanel, FORMAT_TABLE, GridPos } from '../data/panelExport';
import { FieldIndex } from '../sql/fields';
import { SourceConfig } from '../types';
import { bucketAlias, compileLens, kindAlias, metricAlias, uniqueMetricLabels } from './compile';
import { dimLabelIn, LensState } from './state';
import { chartTitle } from './suggest';
import { withMetricAppearance } from './render/fieldConfig';
import { tableOverrides } from './tableChart';
import { autoAxisTitles, withLensStyle } from './render/styleConfig';
import { withReferenceThresholds } from './render/layerConfig';
import { seriesColorOf } from './style';
import { stableColors } from './render/seriesColors';
import { panelSignature, VISUALIZE_SIG_KEY, VISUALIZE_SOURCE_KEY } from './panelSource';
import { gaugeDefaults, gaugeMetrics, gaugeOptions } from './render/gaugeSpec';
import { formatOf, grafanaUnit } from './metricOptions';

export interface LensPanelOpts {
  id: number;
  gridPos: GridPos;
  title?: string;
  description?: string;
  /** `panelSourceOf(...)`: lets the dashboard panel menu reopen the chart in Visualize. */
  source?: string;
  /** The series the chart currently shows: they get the same stable colours as in Visualize. */
  series?: Array<{ name: string; breakdown?: string; synthetic?: boolean }>;
  /** Discovered fields: a Date column keeps its days, KQL filters resolve as in Visualize. */
  index?: FieldIndex;
  /** Gauge without a Maximum value metric or a typed maximum: the automatic maximum Visualize drew. */
  gaugeMax?: number;
}

export interface LensPanel extends ExportedPanel {
  description?: string;
}

type Transformation = NonNullable<ExportedPanel['transformations']>[number];

const LEGEND = { showLegend: true, displayMode: 'list', placement: 'bottom', calcs: [] };

function stackingOf(state: LensState): 'normal' | 'percent' | 'none' {
  // Line has no stacking (Kibana); a sub-type kept from Bar / Area doesn't apply to it.
  if (state.chartType === 'line') {
    return 'none';
  }
  if (state.subType === 'percentage') {
    return 'percent';
  }
  return state.subType === 'stacked' ? 'normal' : 'none';
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

/** A date histogram on X with a breakdown: one series per breakdown value (and metric). */
function splitTimeSeries(state: LensState): boolean {
  const [x, split] = state.buckets;
  return x?.kind === 'date_histogram' && !!split && split.kind !== 'date_histogram';
}

/**
 * Series names of a split time series. After `partitionByValues` each series is a metric field
 * (`m0`) labelled with its breakdown value (`b1`), which Grafana would show as "m0 checkout"
 * (a rename before partitioning doesn't survive it). Name each metric field from its labels
 * instead: the value alone for one metric (Visualize's legend), "value · metric" for several.
 */
function splitSeriesNames(state: LensState): unknown[] {
  const labels = uniqueMetricLabels(state.metrics);
  const value = '${__field.labels.' + bucketAlias(1) + '}';
  return state.metrics.map((_, i) => ({
    matcher: { id: 'byName', options: metricAlias(i) },
    properties: [
      // `$` in a label would read as a dashboard variable in Grafana's display name template.
      { id: 'displayName', value: labels.length > 1 ? `${value} · ${labels[i].replace(/\$/g, '＄')}` : value },
    ],
  }));
}

/** Row-kind columns of top-values buckets (Other / missing): for ordering only, never a series. */
const KIND_COLUMNS = Object.fromEntries([0, 1, 2, 3].map((i) => [kindAlias(i), true]));

function rename(names: Record<string, string>): Transformation {
  return { id: 'organize', options: { renameByName: names, excludeByName: KIND_COLUMNS, indexByName: {} } };
}

/**
 * Per-name colour overrides for XY panels: a breakdown value keeps the colour it has in Visualize
 * (stable by value, or the legend pick) instead of Grafana's by-position palette.
 */
export function seriesColorOverrides(state: LensState, series: LensPanelOpts['series']): unknown[] {
  if (!series || series.length === 0) {
    return [];
  }
  const theme = createTheme();
  const split = series.some((s) => s.breakdown !== undefined);
  // The same keys, order and palette as XyChart, so the same slots come out.
  const colors = stableColors(
    series.map((s) => s.name),
    series.map((s) => !!s.synthetic),
    theme.visualization.palette,
    (n) => theme.visualization.getColorByName(n),
    (n) => seriesColorOf(state.style, n)
  );
  return series.flatMap((s, i) => {
    const picked = seriesColorOf(state.style, s.name);
    if (!split && !picked) {
      return [];
    }
    return [
      {
        matcher: { id: 'byName', options: s.name },
        properties: [{ id: 'color', value: { mode: 'fixed', fixedColor: colors[i] } }],
      },
    ];
  });
}

export function buildLensPanel(
  state: LensState,
  config: SourceConfig,
  conditions: string[],
  timeRange: TimeRange,
  opts: LensPanelOpts
): LensPanel {
  const panel = lensPanel(state, config, conditions, timeRange, opts);
  // Signed as a dashboard stores it, so edits made in Grafana can be told later.
  return opts.source
    ? { ...panel, targets: panel.targets.map((t) => ({ ...t, [VISUALIZE_SIG_KEY]: panelSignature(panel) })) }
    : panel;
}

function lensPanel(
  state: LensState,
  config: SourceConfig,
  conditions: string[],
  timeRange: TimeRange,
  opts: LensPanelOpts
): LensPanel {
  const panel = baseLensPanel(state, config, conditions, timeRange, opts);
  const xy = state.chartType === 'line' || state.chartType === 'area' || state.chartType === 'bar';
  if (!panel.fieldConfig || state.chartType === 'gauge') {
    // A gauge's unit, decimals and colour are in its own field config (colour bands win).
    return panel;
  }
  // Split time series keep the metric aliases as field names (see splitSeriesNames), so their
  // per-metric overrides match the alias, not the label.
  const fieldConfig = withMetricAppearance(
    panel.fieldConfig,
    state,
    xy,
    splitTimeSeries(state) ? (i) => ({ id: 'byName', options: metricAlias(i) }) : undefined
  );
  if (!xy || (panel.type !== 'timeseries' && panel.type !== 'barchart')) {
    return { ...panel, fieldConfig };
  }
  const withColors = {
    ...fieldConfig,
    overrides: [...fieldConfig.overrides, ...seriesColorOverrides(state, opts.series)],
  };
  const styled = withLensStyle(
    { options: (panel.options ?? {}) as Record<string, unknown>, fieldConfig: withColors },
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
  const { sql } = compileLens(state, config, conditions, timeRange, 'dashboard', opts.index);
  const names = columnNames(state);
  const [x, split] = state.buckets;
  const stacking = stackingOf(state);
  // Everything renamed except the split column, which the partition / pivot transformations read.
  const withoutSplit = Object.fromEntries(Object.entries(names).filter(([k]) => k !== bucketAlias(1)));
  // Split time series: the metrics keep their aliases too (named by splitSeriesNames).
  const timeOnly = Object.fromEntries(Object.entries(names).filter(([k]) => k === bucketAlias(0)));
  const base = {
    id: opts.id,
    title: opts.title?.trim() || chartTitle(state),
    ...(opts.description?.trim() ? { description: opts.description.trim() } : {}),
    gridPos: opts.gridPos,
    datasource,
    // Auto date buckets: ~60 per range, like Visualize's auto interval. Grafana's default (the
    // panel width in pixels) gave ~1-minute buckets and hairline bars.
    ...(state.buckets.some((b) => b.kind === 'date_histogram') ? { maxDataPoints: EXPORT_VOLUME_POINTS } : {}),
    targets: [
      {
        refId: 'A',
        datasource,
        editorType: 'sql' as const,
        format: FORMAT_TABLE,
        rawSql: sql,
        ...(opts.source ? { [VISUALIZE_SOURCE_KEY]: opts.source } : {}),
      },
    ],
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
                rename(timeOnly),
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
                // Missing buckets are gaps, never a line drawn across them (count charts are
                // zero-filled by the query, see fillsEmptyBuckets).
                spanNulls: false,
              },
            },
            overrides: splitTimeSeries(state) ? splitSeriesNames(state) : [],
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
    case 'heatmap':
      return heatmapPanel(state, base, names, opts.series);
    case 'gauge':
      return gaugePanel(state, base, opts.gaugeMax);
    case 'metric':
    case 'pie':
    case 'donut': {
      const byCategory = state.buckets.length > 0;
      const pie = state.chartType !== 'metric';
      // Stat tiles and pie slices by category take their names from the row ("payments"); a renamed
      // metric field gets a fixed display name that hides them, so only the category column is
      // renamed and several metric tiles are told apart by "value · metric", as in Visualize.
      const tiles = byCategory;
      const labels = uniqueMetricLabels(state.metrics);
      return {
        ...base,
        type: pie ? 'piechart' : 'stat',
        transformations: [rename(tiles ? { [bucketAlias(0)]: names[bucketAlias(0)] } : names)],
        options: pie
            ? {
                legend: { ...LEGEND, placement: 'right', values: ['value'] },
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
        fieldConfig: {
          defaults: {},
          overrides:
            tiles && state.metrics.length > 1
              ? state.metrics.map((_, i) => ({
                  matcher: { id: 'byName', options: metricAlias(i) },
                  properties: [
                    { id: 'displayName', value: '${__data.fields[0]} · ' + labels[i].replace(/\$/g, '＄') },
                  ],
                }))
              : [],
        },
      };
    }
    case 'table':
      // Summary row and colour by value carry over (LENS-CHART-01); a "Split metrics by" pivot is
      // not exported (one row per combination, as before).
      return {
        ...base,
        type: 'table',
        transformations: [rename(names)],
        options: { showHeader: true, enablePagination: true },
        fieldConfig: {
          defaults: { unit: 'locale', custom: { wrapHeaderText: true } },
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

type PanelBase = Omit<LensPanel, 'type'>;

/**
 * Heat map (R3-CHARTS). A date histogram on X → Grafana's heatmap: the long rows (time, Y value,
 * metric) pivoted into one column per Y value ("heatmap rows", ordinal Y labels), biggest on top.
 * Categories on X have no core panel that draws them as cells, so the export is the same matrix
 * as a table with colour-coded cells (rows = Y values, columns = X values).
 */
function heatmapPanel(
  state: LensState,
  base: PanelBase,
  names: Record<string, string>,
  series?: LensPanelOpts['series']
): LensPanel {
  const [x, y] = state.buckets;
  const pivot: Transformation[] = y
    ? [
        {
          id: 'groupingToMatrix',
          options:
            x?.kind === 'date_histogram'
              ? {
                  columnField: bucketAlias(1),
                  rowField: bucketAlias(0),
                  valueField: metricAlias(0),
                  emptyValue: 'null',
                }
              : {
                  columnField: bucketAlias(0),
                  rowField: bucketAlias(1),
                  valueField: metricAlias(0),
                  emptyValue: 'null',
                },
        },
      ]
    : [];
  const { unit, decimals } = grafanaUnit(formatOf(state.metrics[0]));
  const units = { unit: unit ?? 'locale', ...(decimals !== undefined ? { decimals } : {}) };
  if (x?.kind === 'date_histogram') {
    return {
      ...base,
      type: 'heatmap',
      // Rows in rank order (the biggest on top, as in Visualize): the pivot sorts its columns by value.
      transformations: y
        ? [
            ...pivot,
            {
              id: 'organize',
              options: {
                renameByName: { [`${bucketAlias(0)}\\${bucketAlias(1)}`]: names[bucketAlias(0)] },
                excludeByName: {},
                indexByName: Object.fromEntries([
                  [`${bucketAlias(0)}\\${bucketAlias(1)}`, 0],
                  ...(series ?? []).filter((r) => !r.synthetic).map((r, i) => [r.breakdown ?? r.name, i + 1]),
                ]),
              },
            },
          ]
        : [rename(names)],
      options: {
        calculate: false,
        cellGap: 1,
        color: {
          mode: 'scheme',
          scheme: 'Blues',
          steps: 64,
          exponent: 0.5,
          scale: 'exponential',
          reverse: false,
          fill: 'dark-blue',
        },
        filterValues: { le: -1e-9 },
        rowsFrame: { layout: 'auto' },
        yAxis: { axisPlacement: 'left', reverse: true },
        cellValues: units,
        showValue: 'never',
        legend: { show: true },
        tooltip: { mode: 'single', yHistogram: false, showColorScale: false },
        exemplars: { color: 'rgba(255,0,255,0.7)' },
      },
      fieldConfig: { defaults: { ...units }, overrides: [] },
    };
  }
  return {
    ...base,
    type: 'table',
    transformations: y
      ? [...pivot, rename({ [`${bucketAlias(1)}\\${bucketAlias(0)}`]: names[bucketAlias(1)] })]
      : [rename(names)],
    options: { showHeader: true, enablePagination: true },
    fieldConfig: {
      defaults: {
        ...units,
        color: { mode: 'continuous-blues' },
        custom: { align: 'auto', cellOptions: { type: 'color-background', mode: 'basic' }, wrapHeaderText: true },
      },
      overrides: y
        ? [
            {
              matcher: { id: 'byName', options: names[bucketAlias(1)] },
              properties: [{ id: 'custom.cellOptions', value: { type: 'auto' } }],
            },
          ]
        : [],
    },
  };
}

/**
 * Gauge (R3-CHARTS): Break down by → one gauge per row (Rows to fields: the value names the gauge,
 * the Maximum value metric becomes that gauge's max); without a breakdown the max comes from the
 * same row (Config from query results). Otherwise the typed or the automatic maximum.
 */
function gaugePanel(state: LensState, base: PanelBase, autoMax?: number): LensPanel {
  const { value, max } = gaugeMetrics(state);
  const { pluginId, options } = gaugeOptions(state);
  const valueAlias = metricAlias(Math.max(0, value));
  const maxAlias = max >= 0 ? metricAlias(max) : undefined;
  const staticMax = state.gauge?.max ?? (maxAlias ? undefined : autoMax);
  const transformations: Transformation[] =
    state.buckets.length > 0
      ? [
          {
            id: 'rowsToFields',
            options: {
              mappings: [
                { fieldName: bucketAlias(0), handlerKey: 'field.name' },
                { fieldName: valueAlias, handlerKey: 'field.value' },
                ...(maxAlias ? [{ fieldName: maxAlias, handlerKey: 'max' }] : []),
              ],
            },
          },
        ]
      : maxAlias
        ? [
            {
              id: 'configFromData',
              options: {
                configRefId: 'A',
                mappings: [{ fieldName: maxAlias, handlerKey: 'max', reducerId: 'lastNotNull' }],
                applyTo: { id: 'byName', options: valueAlias },
              },
            },
            { id: 'organize', options: { excludeByName: { [maxAlias]: true }, renameByName: {}, indexByName: {} } },
            rename({ [valueAlias]: columnNames(state)[valueAlias] }),
          ]
        : [rename({ [valueAlias]: columnNames(state)[valueAlias] })];
  return {
    ...base,
    type: pluginId,
    transformations,
    options,
    fieldConfig: {
      defaults: { ...gaugeDefaults(state), ...(staticMax !== undefined ? { max: staticMax } : {}) },
      overrides: [],
    },
  };
}
