/**
 * R3-CHARTS: Bar horizontal, Donut, Heat map, Gauge — state, remapping, suggestions, rendering and
 * dashboard export.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { compileLens, LensResult, shapeLensRows } from '../compile';
import { buildLensPanel } from '../panelExport';
import { cleanGauge, decodeLens, encodeLens, LensState, MetricDim, sanitizeLens } from '../state';
import { chartKind, chartTitle, LensContext, suggestions, switchChart, switchKind } from '../suggest';
import { queryShape } from '../dimensions';
import { dimensionGroups } from '../LensPage';
import { gaugeColumns, panelSpec } from '../render/LensChart';
import { gaugeMaxes, gaugeSpec, gaugeThresholds, niceCeil } from '../render/gaugeSpec';
import { cellValue, HeatmapChart, heatDomain, rampColor, truncateLabel, yLabelWidth } from '../render/HeatmapChart';
import { catAxisWidth } from '../render/XyChart';
import { filterChartTypes } from '../ChartTypeSwitcher';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

jest.mock('@grafana/runtime', () => ({ ...jest.requireActual('@grafana/runtime'), PanelRenderer: () => null }));

const ctx: LensContext = { timeField: { sqlExpr: 'Timestamp', label: 'Timestamp' } };
const date = { kind: 'date_histogram' as const, id: 'bd', field: 'Timestamp', label: 'Timestamp', interval: 'auto' };
const svc = { kind: 'terms' as const, id: 'bs', field: 'ServiceName', label: 'ServiceName', size: 9 };
const lvl = { kind: 'terms' as const, id: 'bl', field: 'SeverityText', label: 'SeverityText', size: 4 };
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const avg: MetricDim = {
  kind: 'metric',
  id: 'm1',
  op: 'avg',
  field: 'SeverityNumber',
  fieldLabel: 'SeverityNumber',
  numeric: true,
};
const maxSev: MetricDim = { ...avg, id: 'm2', op: 'max', role: 'max' };

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const range = {
  from: dateTime(Date.UTC(2026, 0, 5, 6)),
  to: dateTime(Date.UTC(2026, 0, 5, 14)),
  raw: { from: 'now-8h', to: 'now' },
};
const sqlOf = (s: LensState) => compileLens(s, config, [], range).sql;

describe('R3-CHARTS state', () => {
  it('cleanGauge keeps known options only', () => {
    expect(cleanGauge({ shape: 'bar', min: 5, max: 10, bands: 'low' })).toEqual({
      shape: 'bar',
      min: 5,
      max: 10,
      bands: 'low',
    });
    expect(cleanGauge({ shape: 'circle', min: 0, bands: 'x', evil: '<script>' })).toBeUndefined();
    expect(cleanGauge({ min: 10, max: 5 })).toEqual({ min: 10 });
    expect(cleanGauge({ max: Infinity, min: 'x' })).toBeUndefined();
    expect(cleanGauge([1])).toBeUndefined();
  });

  it('decodes the new chart types, gauge options and parked metrics; drops unknown values', () => {
    const s: LensState = {
      chartType: 'gauge',
      buckets: [svc],
      metrics: [count],
      gauge: { shape: 'bar', max: 100 },
      parked: { chartType: 'bar', buckets: [date], metrics: [avg] },
    };
    expect(decodeLens(encodeLens(s))).toEqual(s);
    for (const t of ['donut', 'heatmap'] as const) {
      expect(decodeLens(encodeLens({ ...s, chartType: t }))?.chartType).toBe(t);
    }
    expect(decodeLens(JSON.stringify({ ...s, chartType: 'treemap' }))).toBeUndefined();
    const hostile = decodeLens(
      JSON.stringify({
        ...s,
        gauge: { shape: 'bar', sql: 'x' },
        parked: { chartType: 'bar', buckets: [], metrics: [{ kind: 'metric', id: 'x', op: 'drop' }] },
      })
    );
    expect(hostile?.gauge).toEqual({ shape: 'bar' });
    expect(hostile?.parked).toBeUndefined();
  });

  it('sanitizeLens drops parked metrics on unknown fields; a gauge needs no bucket', () => {
    const s: LensState = {
      chartType: 'gauge',
      buckets: [],
      metrics: [count],
      parked: { chartType: 'bar', buckets: [], metrics: [{ ...avg, field: 'evil()' }] },
    };
    const out = sanitizeLens(s, new Set(['Timestamp', 'SeverityNumber']));
    expect(out.chartType).toBe('gauge');
    expect(out.parked).toBeUndefined();
    const heat = sanitizeLens(
      { chartType: 'heatmap', buckets: [{ ...svc, field: 'nope' }], metrics: [count] },
      new Set()
    );
    expect(heat.chartType).toBe('metric');
  });

  it('gauge options are display-only (not in the query shape)', () => {
    const s: LensState = { chartType: 'gauge', buckets: [], metrics: [count] };
    expect(queryShape({ ...s, gauge: { max: 5 } })).toEqual(queryShape(s));
  });
});

describe('R3-CHARTS switchChart remapping', () => {
  const xy: LensState = { chartType: 'bar', subType: 'stacked', buckets: [date, svc], metrics: [count, avg] };

  it('heat map: date on X, a category on Y, one metric; the rest parked and restored', () => {
    const h = switchChart(xy, 'heatmap', ctx);
    expect(h.buckets.map((b) => b.id)).toEqual(['bd', 'bs']);
    expect(h.metrics.map((m) => m.id)).toEqual(['m0']);
    expect(h.parked?.metrics?.map((m) => m.id)).toEqual(['m1']);
    const back = switchChart(h, 'bar', ctx);
    expect(back.metrics.map((m) => m.id)).toEqual(['m0', 'm1']);
    expect(back.parked).toBeUndefined();
    // A date given second goes to X.
    const swapped = switchChart({ ...xy, buckets: [svc, date] }, 'heatmap', ctx);
    expect(swapped.buckets.map((b) => b.id)).toEqual(['bd', 'bs']);
    // Nothing to put on X: the time field, as Bar does.
    expect(switchChart({ chartType: 'metric', buckets: [], metrics: [count] }, 'heatmap', ctx).buckets[0].kind).toBe(
      'date_histogram'
    );
  });

  it('no extra query: the SQL is the same after a round trip through every new type', () => {
    const two: LensState = { chartType: 'bar', subType: 'stacked', buckets: [date, svc], metrics: [count] };
    const h = switchChart(two, 'heatmap', ctx);
    expect(sqlOf(h)).toBe(sqlOf(two));
    const cat: LensState = { chartType: 'bar', subType: 'stacked', buckets: [svc], metrics: [count] };
    for (const t of ['donut', 'gauge', 'pie'] as const) {
      expect(sqlOf(switchChart(cat, t, ctx))).toBe(sqlOf(cat));
    }
    expect(sqlOf(switchKind(cat, 'bar_horizontal', ctx))).toBe(sqlOf(cat));
  });

  it('gauge: one value, a Maximum value kept, a breakdown that is not time; the date is parked', () => {
    const m: LensState = { chartType: 'metric', buckets: [svc], metrics: [count, avg, maxSev] };
    const g = switchChart(m, 'gauge', ctx);
    expect(g.metrics.map((x) => [x.id, x.role ?? ''])).toEqual([
      ['m0', ''],
      ['m2', 'max'],
    ]);
    expect(g.parked?.metrics?.map((x) => x.id)).toEqual(['m1']);
    const fromBar = switchChart(xy, 'gauge', ctx);
    expect(fromBar.buckets.map((b) => b.id)).toEqual(['bs']);
    expect(fromBar.parked?.buckets.map((b) => b.id)).toEqual(['bd']);
    // Back to a bar: the date returns to X, the maximum is parked (with its role) and comes back on Metric.
    const bar = switchChart(g, 'bar', ctx);
    expect(bar.metrics.some((x) => x.role === 'max')).toBe(false);
    expect(switchChart(bar, 'metric', ctx).metrics.find((x) => x.id === 'm2')?.role).toBe('max');
  });

  it('donut: the same roles as pie', () => {
    const d = switchChart(xy, 'donut', ctx);
    expect(d.buckets.map((b) => b.id)).toEqual(['bs']);
    expect(d.metrics.map((m) => m.id)).toEqual(['m0']);
    expect(switchChart(d, 'bar', ctx).buckets.map((b) => b.id)).toEqual(['bd', 'bs']);
  });

  it('gauge options survive a switch away and back', () => {
    const g: LensState = { chartType: 'gauge', buckets: [svc], metrics: [count], gauge: { shape: 'bar' } };
    expect(switchChart(switchChart(g, 'table', ctx), 'gauge', ctx).gauge).toEqual({ shape: 'bar' });
  });
});

describe('R3-CHARTS Bar horizontal', () => {
  const bar: LensState = { chartType: 'bar', subType: 'percentage', buckets: [svc, lvl], metrics: [count] };

  it('is a Bar with Style → Bar orientation horizontal; switching to Bar clears it', () => {
    const h = switchKind(bar, 'bar_horizontal', ctx);
    expect(h.chartType).toBe('bar');
    expect(h.style?.orientation).toBe('horizontal');
    expect(h.subType).toBe('percentage');
    expect(chartKind(h)).toBe('bar_horizontal');
    expect(chartTitle(h)).toBe('Bar horizontal percentage');
    const v = switchKind({ ...h, style: { ...h.style, barValues: 'show' } }, 'bar', ctx);
    expect(v.style).toEqual({ barValues: 'show' });
    expect(chartKind(v)).toBe('bar');
    // Through a pie and back: the orientation was parked with the Style.
    expect(chartKind(switchChart(switchChart(h, 'pie', ctx), 'bar', ctx))).toBe('bar_horizontal');
  });

  it('dimension groups follow the drawing (categories on the vertical axis)', () => {
    const h = switchKind(bar, 'bar_horizontal', ctx);
    expect(dimensionGroups(h).map((g) => [g.name, g.role])).toEqual([
      ['Vertical axis', 'bucket'],
      ['Horizontal axis', 'metric'],
      ['Breakdown', 'bucket'],
    ]);
  });

  it('category axis is as wide as its longest label, within limits; labels are cut with an ellipsis', () => {
    const r = (labels: string[]): LensResult => ({
      xs: labels,
      xLabels: labels,
      xSynthetic: labels.map(() => false),
      xIsTime: false,
      series: [],
      table: { columns: [], rows: [] },
    });
    expect(catAxisWidth(r(['a']), 800)).toBe(48);
    expect(catAxisWidth(r(['inventory']), 800)).toBeGreaterThan(70);
    expect(catAxisWidth(r(['x'.repeat(200)]), 800)).toBe(260);
    expect(catAxisWidth(r(['x'.repeat(200)]), 400)).toBe(140);
    expect(truncateLabel('inventory', catAxisWidth(r(['inventory']), 800))).toBe('inventory');
    expect(truncateLabel('Timeout after 4035ms calling payments', 100)).toBe('Timeout afte…');
  });
});

describe('R3-CHARTS suggestions and switcher', () => {
  it('heat map only for time × categories with one metric; never auto-picked', () => {
    const t = suggestions({ chartType: 'line', buckets: [date, svc], metrics: [count] }, ctx).map((s) => s.title);
    expect(t).toContain('Heat map');
    expect(
      suggestions({ chartType: 'line', buckets: [date], metrics: [count] }, ctx).map((s) => s.title)
    ).not.toContain('Heat map');
    expect(
      suggestions({ chartType: 'line', buckets: [date, svc], metrics: [count, avg] }, ctx).map((s) => s.title)
    ).not.toContain('Heat map');
  });

  it('bar horizontal for top values on X; gauge only for a metric with a maximum', () => {
    const cards = suggestions({ chartType: 'bar', subType: 'stacked', buckets: [svc], metrics: [count] }, ctx);
    const h = cards.find((c) => c.title === 'Bar horizontal');
    expect(h && chartKind(h.state)).toBe('bar_horizontal');
    expect(cards.map((c) => c.title)).not.toContain('Gauge');
    const withMax = suggestions({ chartType: 'metric', buckets: [], metrics: [count, maxSev] }, ctx);
    expect(withMax.find((c) => c.title === 'Gauge')?.state.chartType).toBe('gauge');
  });

  it('the switcher lists the new entries', () => {
    expect(filterChartTypes('')).toEqual([
      'bar',
      'bar_horizontal',
      'line',
      'area',
      'metric',
      'table',
      'pie',
      'donut',
      'heatmap',
      'gauge',
    ]);
    expect(filterChartTypes('gauge')).toEqual(['gauge']);
  });
});

describe('R3-CHARTS rendering', () => {
  it('donut: a piechart with a hole', () => {
    const s: LensState = { chartType: 'donut', buckets: [svc], metrics: [count] };
    const spec = panelSpec(
      s,
      shapeLensRows(s, [
        { b0: 'payments', m0: 9 },
        { b0: 'auth', m0: 3 },
      ])
    );
    expect(spec.pluginId).toBe('piechart');
    expect(spec.options.pieType).toBe('donut');
  });

  it('gauge: one field per value with its own maximum; auto max is a round number above the largest', () => {
    expect(niceCeil(1217)).toBe(1500);
    expect(niceCeil(20)).toBe(20);
    expect(niceCeil(0.37)).toBeCloseTo(0.4);
    const s: LensState = { chartType: 'gauge', buckets: [svc], metrics: [count] };
    const rows = [
      { b0: 'payments', m0: 1217 },
      { b0: 'auth', m0: 19 },
    ];
    const spec = gaugeSpec(s, shapeLensRows(s, rows));
    expect(spec.pluginId).toBe('gauge');
    expect(spec.frames[0].fields.map((f) => [f.name, f.values[0], f.config.max])).toEqual([
      ['payments', 1217, 1500],
      ['auth', 19, 1500],
    ]);
    expect(spec.fieldConfig.defaults.min).toBe(0);
    // Typed max; then a Maximum value metric per gauge (a max at or below min falls back).
    expect(gaugeSpec({ ...s, gauge: { max: 2000 } }, shapeLensRows(s, rows)).frames[0].fields[0].config.max).toBe(2000);
    expect(gaugeMaxes({ ...s, gauge: { max: 50 } }, [10, 20], [40, 0])).toEqual([40, 50]);
    const bar = gaugeSpec({ ...s, gauge: { shape: 'bar' } }, shapeLensRows(s, rows));
    expect(bar.pluginId).toBe('bargauge');
    expect(bar.options.orientation).toBe('horizontal');
  });

  it('gauge colour bands', () => {
    expect(gaugeThresholds(undefined, '#123456')).toEqual({
      mode: 'absolute',
      steps: [{ color: '#123456', value: null }],
    });
    const low = gaugeThresholds('low', '#123456');
    expect(low.mode).toBe('percentage');
    expect(low.steps.map((x) => x.value)).toEqual([null, 70, 90]);
    expect(gaugeThresholds('high', '#000000').steps[0].color).toBe(low.steps[2].color);
  });

  it('gauge grid: equal cells, as large as fit', () => {
    expect(gaugeColumns(1, 600, 400)).toBe(1);
    expect(gaugeColumns(5, 620, 480)).toBe(3);
    expect(gaugeColumns(4, 1200, 200)).toBe(4);
  });

  it('heat map helpers', () => {
    expect(rampColor(['#000000', '#ffffff'], 0)).toBe('#000000');
    expect(rampColor(['#000000', '#ffffff'], 0.5)).toBe('#808080');
    expect(rampColor(['#000000', '#ffffff'], 7)).toBe('#ffffff');
    expect(heatDomain([])).toEqual([0, 1]);
    expect(heatDomain([5, 5])).toEqual([0, 5]);
    expect(heatDomain([-2, 3])).toEqual([-2, 3]);
    expect(yLabelWidth(['a'], 800)).toBe(40);
    expect(yLabelWidth(['x'.repeat(100)], 400)).toBe(140);
  });
});

describe('R3-CHARTS HeatmapChart', () => {
  beforeAll(() => {
    (global as any).ResizeObserver = class {
      cb: (e: unknown[]) => void;
      constructor(cb: (e: unknown[]) => void) {
        this.cb = cb;
      }
      observe() {
        this.cb([{ contentRect: { width: 600, height: 300 } }]);
      }
      disconnect() {}
    };
  });
  const s: LensState = { chartType: 'heatmap', buckets: [svc, lvl], metrics: [count] };
  // Ranked Y: error has the bigger total, so it is the first (top) row; no auth × warn row → empty cell.
  const rows = [
    { b0: 'payments', b1: 'error', m0: 1200 },
    { b0: 'payments', b1: 'warn', m0: 0 },
    { b0: 'auth', b1: 'error', m0: 19 },
  ];
  const result = shapeLensRows(s, rows);

  it('draws a cell per X × Y; an empty cell is not a zero', () => {
    expect(cellValue(result, 1, 1)).toBeNull();
    expect(cellValue(result, 0, 1)).toBe(0);
    render(<HeatmapChart result={result} metric={count} metricLabel="Count of records" yTitle="SeverityText" />);
    const cells = screen.getAllByRole('gridcell');
    expect(cells).toHaveLength(4);
    expect(screen.getAllByTestId('lens-heatmap-y').map((t) => t.textContent)).toEqual(['errorerror', 'warnwarn']);
    expect(screen.getByRole('gridcell', { name: 'auth · warn: No data' })).toHaveAttribute('data-value', '');
    expect(screen.getByRole('gridcell', { name: 'payments · warn: 0' })).toHaveAttribute('data-value', '0');
    expect(screen.getByRole('grid', { name: 'Heat map: Count of records' })).toBeTruthy();
    expect(screen.getByTestId('lens-heatmap-legend')).toHaveAttribute('aria-label', 'Color scale from 0 to 1,200');
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('click and keyboard select a cell (the same filter chooser as XY charts); hover shows the tooltip', () => {
    const onSelect = jest.fn();
    render(<HeatmapChart result={result} metric={count} metricLabel="Count of records" onSelect={onSelect} />);
    const cell = screen.getByRole('gridcell', { name: 'auth · error: 19' });
    fireEvent.mouseEnter(cell);
    expect(screen.getByRole('tooltip').textContent).toContain('19');
    expect(screen.getByRole('tooltip').textContent).toContain('Count of records');
    fireEvent.click(cell);
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xIndex: 1, seriesIndex: 0 }));
    // Empty cells don't filter.
    fireEvent.click(screen.getByRole('gridcell', { name: 'auth · warn: No data' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    const grid = screen.getByRole('grid');
    grid.focus();
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xIndex: 0, seriesIndex: 0 }));
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(expect.objectContaining({ xIndex: 0, seriesIndex: 1 }));
  });
});

describe('R3-CHARTS dashboard export', () => {
  const build = (s: LensState, opts: Partial<Parameters<typeof buildLensPanel>[4]> = {}) =>
    buildLensPanel(s, config, [], range, { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 }, ...opts });

  it('bar horizontal → barchart, orientation horizontal', () => {
    const p = build(
      switchKind({ chartType: 'bar', subType: 'stacked', buckets: [svc], metrics: [count] }, 'bar_horizontal', ctx)
    );
    expect(p.type).toBe('barchart');
    expect((p.options as Record<string, unknown>).orientation).toBe('horizontal');
  });

  it('donut → piechart donut', () => {
    const p = build({ chartType: 'donut', buckets: [svc], metrics: [count] });
    expect(p.type).toBe('piechart');
    expect((p.options as Record<string, unknown>).pieType).toBe('donut');
  });

  it('heat map over time → heatmap of rows in rank order; categories → colour-coded table', () => {
    const p = build(
      { chartType: 'heatmap', buckets: [date, svc], metrics: [count] },
      {
        series: [
          { name: 'payments', breakdown: 'payments' },
          { name: 'auth', breakdown: 'auth' },
          { name: 'Other', breakdown: 'Other', synthetic: true },
        ],
      }
    );
    expect(p.type).toBe('heatmap');
    expect(p.targets[0].rawSql).toContain('$__timeInterval');
    expect(p.transformations?.[0]).toMatchObject({
      id: 'groupingToMatrix',
      options: { columnField: 'b1', rowField: 'b0' },
    });
    expect(p.transformations?.[1]).toMatchObject({
      id: 'organize',
      options: { indexByName: { 'b0\\b1': 0, payments: 1, auth: 2 }, renameByName: { 'b0\\b1': 'Timestamp' } },
    });
    expect((p.options as Record<string, unknown>).calculate).toBe(false);
    const t = build({ chartType: 'heatmap', buckets: [svc, lvl], metrics: [count] });
    expect(t.type).toBe('table');
    expect(t.fieldConfig?.defaults).toMatchObject({
      color: { mode: 'continuous-blues' },
      custom: { cellOptions: { type: 'color-background' } },
    });
  });

  it('gauge: rows to fields with the maximum metric; one row: config from query results; else static', () => {
    const g = build({ chartType: 'gauge', buckets: [svc], metrics: [avg, maxSev], gauge: { bands: 'low' } });
    expect(g.type).toBe('gauge');
    expect(g.transformations?.[0]).toEqual({
      id: 'rowsToFields',
      options: {
        mappings: [
          { fieldName: 'b0', handlerKey: 'field.name' },
          { fieldName: 'm0', handlerKey: 'field.value' },
          { fieldName: 'm1', handlerKey: 'max' },
        ],
      },
    });
    expect((g.fieldConfig?.defaults as Record<string, any>).thresholds.mode).toBe('percentage');
    const one = build({ chartType: 'gauge', buckets: [], metrics: [count, maxSev], gauge: { shape: 'bar' } });
    expect(one.type).toBe('bargauge');
    expect(one.transformations?.[0]).toMatchObject({ id: 'configFromData', options: { configRefId: 'A' } });
    const auto = build({ chartType: 'gauge', buckets: [], metrics: [count] }, { gaugeMax: 1500 });
    expect((auto.fieldConfig?.defaults as Record<string, unknown>).max).toBe(1500);
    const typed = build({ chartType: 'gauge', buckets: [], metrics: [count], gauge: { max: 99 } }, { gaugeMax: 1500 });
    expect((typed.fieldConfig?.defaults as Record<string, unknown>).max).toBe(99);
  });
});
