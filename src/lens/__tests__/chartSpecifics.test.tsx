import React from 'react';
import { render, screen } from '@testing-library/react';
import { panelSpec } from '../render/LensChart';
import { metricTiles, MetricTiles, EMPTY_TILE } from '../render/MetricTiles';
import { dimensionGroups } from '../LensPage';
import { shapeLensRows } from '../compile';
import { decodeLens, encodeLens, LensState, MetricDim } from '../state';
import { tableColumns, tableOverrides, PIVOT_SEP, MAX_PIVOT_COLUMNS } from '../tableChart';
import { switchChart } from '../suggest';
import { addBucket, addMetric, queryShape } from '../dimensions';
import { withTableOptions } from '../TableMetricOptions';
import { buildLensPanel } from '../panelExport';
import { dateTime } from '@grafana/data';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

jest.mock('@grafana/runtime', () => ({ ...jest.requireActual('@grafana/runtime'), PanelRenderer: () => null }));

const svc = { kind: 'terms' as const, id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 };
const sev = { kind: 'terms' as const, id: 'b1', field: 'SeverityText', label: 'SeverityText', size: 9 };
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const maxSev: MetricDim = { kind: 'metric', id: 'm1', op: 'max', field: 'SeverityNumber', numeric: true };
const ctx = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };

describe('Table: Split metrics by (pivot)', () => {
  const state: LensState = { chartType: 'table', buckets: [svc, { ...sev, pivot: true }], metrics: [count] };
  const rows = [
    { b0: 'auth', b1: 'ERROR', m0: 2 },
    { b0: 'auth', b1: 'INFO', m0: 5 },
    { b0: 'payments', b1: 'INFO', m0: 7 },
  ];

  it('one row per row-bucket value, one column per pivot value × metric; a missing combination is empty', () => {
    const cols = tableColumns(state, shapeLensRows(state, rows).table);
    expect(cols.map((c) => c.name)).toEqual([
      'Top 9 values of ServiceName',
      `ERROR${PIVOT_SEP}Count of records`,
      `INFO${PIVOT_SEP}Count of records`,
    ]);
    expect(cols[0].values).toEqual(['auth', 'payments']);
    expect(cols[1].values).toEqual([2, null]);
    expect(cols[2].values).toEqual([5, 7]);
    expect(cols[1].metricIndex).toBe(0);
  });

  it('without pivot buckets the columns are unchanged', () => {
    const plain: LensState = { ...state, buckets: [svc, sev] };
    const cols = tableColumns(plain, shapeLensRows(plain, rows).table);
    expect(cols.map((c) => c.name)).toEqual([
      'Top 9 values of ServiceName',
      'Top 9 values of SeverityText',
      'Count of records',
    ]);
    expect(cols[2].values).toEqual([2, 5, 7]);
  });

  it('caps the pivot column groups', () => {
    const many = Array.from({ length: MAX_PIVOT_COLUMNS + 5 }, (_, i) => ({ b0: 'auth', b1: `v${i}`, m0: i }));
    const cols = tableColumns(state, shapeLensRows(state, many).table);
    expect(cols).toHaveLength(1 + MAX_PIVOT_COLUMNS);
  });

  it('the table panel gets the pivoted frame', () => {
    const spec = panelSpec(state, shapeLensRows(state, rows));
    expect(spec.pluginId).toBe('table');
    expect(spec.frames[0].fields.map((f) => f.name)).toHaveLength(3);
  });
});

describe('Table: summary row and colour by value', () => {
  it('overrides per metric column, matched by name (every pivot column of that metric)', () => {
    const metrics = [{ ...count, summary: 'sum' as const, colorBy: 'cell' as const }];
    const overrides = tableOverrides(
      [
        { name: 'ServiceName', kind: 'string', values: [] },
        { name: 'ERROR › Count of records', kind: 'number', values: [], metricIndex: 0 },
        { name: 'INFO › Count of records', kind: 'number', values: [], metricIndex: 0 },
      ],
      metrics
    ) as any[];
    expect(overrides).toHaveLength(2);
    expect(overrides[0]).toEqual({
      matcher: { id: 'byName', options: 'ERROR › Count of records' },
      properties: [
        { id: 'custom.footer', value: { reducers: ['sum'] } },
        { id: 'custom.cellOptions', value: { type: 'color-background', mode: 'gradient' } },
        { id: 'color', value: { mode: 'continuous-GrYlRd' } },
      ],
    });
  });

  it('average maps to Grafana mean; text colouring; nothing set → no override', () => {
    const o = tableOverrides(
      [{ name: 'x', kind: 'number', values: [], metricIndex: 0 }],
      [{ ...count, summary: 'avg', colorBy: 'text' }]
    ) as any[];
    expect(o[0].properties[0].value).toEqual({ reducers: ['mean'] });
    expect(o[0].properties[1].value).toEqual({ type: 'color-text' });
    expect(tableOverrides([{ name: 'x', kind: 'number', values: [], metricIndex: 0 }], [count])).toEqual([]);
  });

  it('withTableOptions sets and clears', () => {
    const m = withTableOptions(count, { summary: 'max', colorBy: 'text' });
    expect(m).toMatchObject({ summary: 'max', colorBy: 'text' });
    expect(withTableOptions(m, { summary: 'none', colorBy: 'none' })).toEqual(count);
  });

  it('the exported dashboard table panel carries the overrides', () => {
    const state: LensState = { chartType: 'table', buckets: [svc], metrics: [{ ...count, summary: 'sum' }] };
    const config: SourceConfig = {
      datasourceUid: 'ds',
      database: 'default',
      logsTable: 'spec_logs',
      isOtel: true,
      sequentialConsistency: false,
      columns: { ...OTEL_COLUMN_MAPPING },
    };
    const t = dateTime(0);
    const panel = buildLensPanel(
      state,
      config,
      [],
      { from: t, to: t, raw: { from: t, to: t } },
      {
        id: 1,
        gridPos: { x: 0, y: 0, w: 12, h: 8 },
      }
    ) as any;
    expect(JSON.stringify(panel.fieldConfig.overrides)).toContain('"reducers":["sum"]');
  });
});

describe('Metric chart tiles', () => {
  it('one tile per breakdown value; secondary metric; progress against the Maximum value', () => {
    const avg: MetricDim = { kind: 'metric', id: 'm2', op: 'avg', field: 'SeverityNumber', numeric: true };
    const state: LensState = { chartType: 'metric', buckets: [svc], metrics: [count, avg, { ...maxSev, role: 'max' }] };
    const result = shapeLensRows(state, [
      { b0: 'auth', m0: 10, m1: 4, m2: 20 },
      { b0: 'payments', m0: 30, m1: 2, m2: 0 },
    ]);
    const tiles = metricTiles(state, result);
    expect(tiles.map((t) => t.title)).toEqual(['auth', 'payments']);
    expect(tiles[0]).toMatchObject({ value: '10', percent: 50 });
    expect(tiles[0].secondary).toEqual({ label: 'Average of SeverityNumber', value: '4' });
    // A maximum of 0 draws no bar.
    expect(tiles[1].percent).toBeUndefined();
  });

  it('a single tile titled by the metric; the value capped at 100%; format applies', () => {
    const state: LensState = {
      chartType: 'metric',
      buckets: [],
      metrics: [
        { ...count, format: { id: 'bytes' } },
        { ...maxSev, role: 'max' },
      ],
    };
    const tiles = metricTiles(state, shapeLensRows(state, [{ m0: 2048, m1: 1000 }]));
    expect(tiles).toHaveLength(1);
    expect(tiles[0].title).toBe('Count of records');
    expect(tiles[0].value).toBe('2 KiB');
    expect(tiles[0].percent).toBe(100);
  });

  it('an empty tile shows a dash', () => {
    const state: LensState = { chartType: 'metric', buckets: [], metrics: [count] };
    expect(metricTiles(state, shapeLensRows(state, []))[0].value).toBe(EMPTY_TILE);
  });

  it('renders tiles with a progress bar', () => {
    const state: LensState = { chartType: 'metric', buckets: [], metrics: [count, { ...maxSev, role: 'max' }] };
    render(<MetricTiles state={state} result={shapeLensRows(state, [{ m0: 5, m1: 10 }])} />);
    expect(screen.getByRole('listitem', { name: 'Count of records: 5' })).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });
});

describe('groups, adding, chart switches, URL', () => {
  it('Maximum value / Split metrics by groups hold the tagged dimensions', () => {
    const metric: LensState = { chartType: 'metric', buckets: [], metrics: [{ ...maxSev, role: 'max' }, count] };
    const g = Object.fromEntries(dimensionGroups(metric).map((x) => [x.name, x.dims.map((d) => d.id)]));
    expect(g['Primary metric']).toEqual(['m0']);
    expect(g['Maximum value']).toEqual(['m1']);
    const table: LensState = { chartType: 'table', buckets: [svc, { ...sev, pivot: true }], metrics: [count] };
    const t = Object.fromEntries(dimensionGroups(table).map((x) => [x.name, x.dims.map((d) => d.id)]));
    expect(t['Rows']).toEqual(['b0']);
    expect(t['Split metrics by']).toEqual(['b1']);
  });

  it('adding to Maximum value keeps two value metrics; adding to Split metrics by pivots', () => {
    const s: LensState = { chartType: 'metric', buckets: [], metrics: [count, { ...maxSev, id: 'm9' }] };
    const { state } = addMetric(s, ctx, { role: 'max' });
    expect(state.metrics.filter((m) => m.role !== 'max')).toHaveLength(2);
    expect(state.metrics.filter((m) => m.role === 'max')).toHaveLength(1);
    const t = addBucket(
      { chartType: 'table', buckets: [svc], metrics: [count] },
      { id: 'SeverityText', label: 'SeverityText', sqlExpr: 'SeverityText', type: 'string' } as any,
      ctx,
      { pivot: true }
    );
    expect(t.state.buckets[1].pivot).toBe(true);
  });

  it('switching away drops roles and pivots; a metric chart with only a maximum gets a count', () => {
    const table: LensState = { chartType: 'table', buckets: [svc, { ...sev, pivot: true }], metrics: [count] };
    expect(switchChart(table, 'bar', ctx).buckets.some((b) => b.pivot)).toBe(false);
    const metric: LensState = { chartType: 'metric', buckets: [], metrics: [count, { ...maxSev, role: 'max' }] };
    expect(switchChart(metric, 'table', ctx).metrics.some((m) => m.role)).toBe(false);
    const onlyMax = switchChart(
      { chartType: 'metric', buckets: [], metrics: [{ ...maxSev, role: 'max' }] },
      'metric',
      ctx
    );
    expect(onlyMax.metrics.map((m) => m.role ?? 'value')).toEqual(['value', 'max']);
  });

  it('display-only options do not change the query shape', () => {
    const a: LensState = { chartType: 'table', buckets: [svc, sev], metrics: [count] };
    const b: LensState = {
      chartType: 'table',
      buckets: [svc, { ...sev, pivot: true }],
      metrics: [{ ...count, summary: 'sum', colorBy: 'cell' }],
    };
    expect(queryShape(b)).toEqual(queryShape(a));
  });

  it('the URL keeps the options; unknown or ill-typed values are dropped', () => {
    const s: LensState = {
      chartType: 'table',
      buckets: [{ ...svc, pivot: true }],
      metrics: [{ ...count, summary: 'avg', colorBy: 'text', role: 'max' }],
    };
    expect(decodeLens(encodeLens(s))).toMatchObject(s);
    const hostile = JSON.stringify({
      chartType: 'table',
      buckets: [{ ...svc, pivot: 'yes' }],
      metrics: [{ ...count, summary: 'median; DROP', colorBy: 'blink', role: 'admin' }],
    });
    const d = decodeLens(hostile)!;
    expect(d.buckets[0].pivot).toBeUndefined();
    expect(d.metrics[0]).toEqual({ kind: 'metric', id: 'm0', op: 'count', name: undefined });
  });
});
