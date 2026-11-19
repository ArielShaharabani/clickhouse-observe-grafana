import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import {
  compileAnnotationQuery,
  compileReferenceValues,
  LensResult,
  shapeAnnotationRows,
  shapeReferenceRow,
} from '../compile';
import { queryShape } from '../dimensions';
import {
  addLayer,
  cleanLayers,
  clearLayer,
  computedLines,
  duplicateLayer,
  ExtraLayer,
  MAX_LAYER_ITEMS,
  MAX_LAYERS,
  queryAnnotations,
  removeItem,
  removeLayer,
  resolveLayers,
  sanitizeLayers,
  upsertItem,
} from '../layers';
import { kqlError, LayerItemEditor, LayersSection, parseAnnotationTime } from '../LayerPanel';
import { buildLensPanel } from '../panelExport';
import { XyChart } from '../render/XyChart';
import { exportableLines, withReferenceThresholds } from '../render/layerConfig';
import { decodeLens, encodeLens, LensField, LensState, sanitizeLens } from '../state';
import { switchChart } from '../suggest';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: true,
  sequentialConsistency: false,
  columns: { ...OTEL_COLUMN_MAPPING, partitionTimestamp: '-' },
};
const from = dateTime(Date.UTC(2026, 0, 1));
const to = dateTime(Date.UTC(2026, 0, 8));
const range = { from, to, raw: { from, to } };
const timeCond = 'Timestamp >= $__fromTime AND Timestamp <= $__toTime';
const ctx = { timeField: { id: 'Timestamp', sqlExpr: 'Timestamp', label: 'Timestamp', type: 'time' as const } };

const refLayer: ExtraLayer = {
  kind: 'referenceLine',
  id: 'L1',
  lines: [
    { id: 'r1', value: 100, label: 'SLO', color: '#00ff00', lineStyle: 'dashed', fill: 'above' },
    {
      id: 'r2',
      value: 0,
      computed: { op: 'avg', field: 'SeverityNumber', fieldLabel: 'SeverityNumber', numeric: true },
    },
  ],
};
const annLayer: ExtraLayer = {
  kind: 'annotations',
  id: 'L2',
  annotations: [
    { id: 'a1', type: 'manual', time: Date.UTC(2026, 0, 5, 9), end: Date.UTC(2026, 0, 5, 11), label: 'Incident' },
    { id: 'a2', type: 'query', query: 'http.status_code : 503' },
  ],
};
const base: LensState = {
  chartType: 'bar',
  subType: 'stacked',
  buckets: [{ kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: 'auto' }],
  metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
  layers: [refLayer, annLayer],
};

describe('cleanLayers (untrusted URL / draft / saved chart input)', () => {
  it('keeps well-formed layers as they are', () => {
    expect(cleanLayers(base.layers)).toEqual(base.layers);
  });

  it('drops unknown keys, bad values and hostile strings; caps lengths and counts', () => {
    const out = cleanLayers([
      {
        kind: 'referenceLine',
        id: '"><script>',
        evil: 1,
        lines: [
          {
            id: 'a',
            value: 5,
            label: 'x'.repeat(500),
            color: 'red',
            axis: 'top',
            lineStyle: 'wavy',
            fill: 'all',
            sql: 'DROP',
          },
          { id: 'b', value: Infinity },
          { id: 'c', value: '7' },
          { id: 'a', value: 1, label: '   ' },
          { id: 'd', computed: { op: 'percentile', field: 'x' } },
          { id: 'e', computed: { op: 'sum' } },
          { id: 'f', computed: { op: 'count', field: 'ignored' } },
          { id: 'g', value: 1, computed: { op: 'max', field: 'y'.repeat(2000) } },
        ],
      },
      {
        kind: 'annotations',
        id: 'ok',
        annotations: [
          { id: 'm', type: 'manual', time: NaN },
          { id: 'n', type: 'manual', time: -5 },
          { id: 'o', type: 'manual', time: 1e20 },
          { id: 'p', type: 'manual', time: 1000, end: 500, label: '<b>x</b>', color: '#ABCDEF' },
          { id: 'q', type: 'query', query: 'a'.repeat(1001) },
          { id: 'r', type: 'query', query: 42 },
          { id: 's', type: 'script', query: 'x' },
          { id: 't', type: 'query', query: "x : 'y'" },
        ],
      },
      { kind: 'visualization', id: 'v', buckets: [] },
      'junk',
      null,
    ]);
    expect(out).toEqual([
      {
        kind: 'referenceLine',
        id: 'layer0',
        lines: [
          { id: 'a', value: 5, label: 'x'.repeat(120) },
          // A repeated id gets a fresh one; a blank label is dropped.
          { id: 'rl3', value: 1 },
          { id: 'f', value: 0, computed: { op: 'count' } },
          { id: 'g', value: 1 },
        ],
      },
      {
        kind: 'annotations',
        id: 'ok',
        annotations: [
          // The end before the start is dropped; the label stays plain text.
          { id: 'p', type: 'manual', time: 1000, label: '<b>x</b>', color: '#ABCDEF' },
          { id: 't', type: 'query', query: "x : 'y'" },
        ],
      },
    ]);
    expect(cleanLayers(Array.from({ length: 20 }, () => ({ kind: 'referenceLine', lines: [] })))).toHaveLength(
      MAX_LAYERS
    );
    const many = cleanLayers([
      { kind: 'referenceLine', id: 'x', lines: Array.from({ length: 50 }, (_, i) => ({ value: i })) },
    ]);
    expect((many?.[0] as { lines: unknown[] }).lines).toHaveLength(MAX_LAYER_ITEMS);
    expect(cleanLayers({})).toBeUndefined();
    expect(cleanLayers([])).toBeUndefined();
    expect(cleanLayers('[]')).toBeUndefined();
  });

  it('round-trips through the lens URL codec; hostile layers are dropped', () => {
    expect(decodeLens(encodeLens(base))).toEqual(base);
    const hostile = JSON.stringify({
      ...base,
      layers: [{ kind: 'referenceLine', lines: [{ value: 'NaN' }], x: 1 }, 7],
    });
    expect(decodeLens(hostile)?.layers).toEqual([{ kind: 'referenceLine', id: 'layer0', lines: [] }]);
    expect(decodeLens(JSON.stringify({ ...base, layers: 'x' }))?.layers).toBeUndefined();
  });

  it('sanitizeLens drops computed lines on fields the view does not have', () => {
    const allowed = new Set(['Timestamp', 'ServiceName']);
    const out = sanitizeLens(base, allowed);
    expect(out.layers?.[0]).toEqual({ ...refLayer, lines: [refLayer.lines[0]] });
    // Nothing to drop → the same state object (no URL rewrite).
    const ok = sanitizeLens(base, new Set(['Timestamp', 'SeverityNumber']));
    expect(ok).toBe(base);
    expect(sanitizeLayers(undefined, allowed)).toBeUndefined();
  });

  it('is not part of the chart query; XY chart switches keep it, other types drop it', () => {
    expect(queryShape(base).layers).toBeUndefined();
    expect(switchChart(base, 'line', ctx).layers).toEqual(base.layers);
    expect(switchChart(base, 'table', ctx).layers).toBeUndefined();
    expect(switchChart(switchChart(base, 'table', ctx), 'bar', ctx).layers).toBeUndefined();
  });
});

describe('layer actions', () => {
  it('add, clear, duplicate (fresh ids), remove; caps respected', () => {
    let layers = addLayer(undefined, 'referenceLine');
    expect(layers).toEqual([{ kind: 'referenceLine', id: expect.any(String), lines: [] }]);
    layers = upsertItem(layers, layers[0].id, { id: 'x', value: 3 });
    layers = upsertItem(layers, layers[0].id, { id: 'x', value: 4 });
    expect(layers[0]).toMatchObject({ lines: [{ id: 'x', value: 4 }] });
    const dup = duplicateLayer(layers, layers[0].id);
    expect(dup).toHaveLength(2);
    expect(dup[1].id).not.toBe(dup[0].id);
    expect((dup[1] as { lines: Array<{ id: string; value: number }> }).lines[0]).toMatchObject({ value: 4 });
    expect((dup[1] as { lines: Array<{ id: string }> }).lines[0].id).not.toBe('x');
    expect(clearLayer(dup, dup[0].id)[0]).toMatchObject({ lines: [] });
    expect(clearLayer(dup, dup[0].id)[1]).toBe(dup[1]);
    expect(removeItem(dup, dup[0].id, 'x')[0]).toMatchObject({ lines: [] });
    expect(removeLayer(dup, dup[0].id)).toEqual([dup[1]]);
    const full = Array.from({ length: MAX_LAYERS }, () => addLayer(undefined, 'annotations')[0]);
    expect(addLayer(full, 'referenceLine')).toBe(full);
    expect(duplicateLayer(full, full[0].id)).toBe(full);
    let items = addLayer(undefined, 'annotations');
    for (let i = 0; i < MAX_LAYER_ITEMS + 3; i++) {
      items = upsertItem(items, items[0].id, { id: `a${i}`, type: 'manual', time: i });
    }
    expect((items[0] as { annotations: unknown[] }).annotations).toHaveLength(MAX_LAYER_ITEMS);
  });

  it('lists computed lines and query annotations; resolves what the chart draws', () => {
    expect(computedLines(base.layers).map((l) => l.id)).toEqual(['r2']);
    expect(queryAnnotations(base.layers).map((a) => a.id)).toEqual(['a2']);
    // Before the computed value / events arrive: only the static line and the manual annotation.
    const before = resolveLayers(base.layers);
    expect(before.lines.map((l) => [l.id, l.value, l.text])).toEqual([['r1', 100, 'SLO']]);
    expect(before.events.map((e) => e.key)).toEqual(['a1']);
    const after = resolveLayers(base.layers, { values: { r2: 9.5 }, events: { a2: [3000, 2000] } });
    expect(after.lines.map((l) => [l.id, l.value, l.text, l.label])).toEqual([
      ['r1', 100, 'SLO', 'SLO'],
      ['r2', 9.5, 'Average of SeverityNumber', undefined],
    ]);
    expect(after.events.map((e) => [e.key, e.time, e.text])).toEqual([
      ['a1', Date.UTC(2026, 0, 5, 9), 'Incident'],
      ['a2:0', 3000, 'http.status_code : 503'],
      ['a2:1', 2000, 'http.status_code : 503'],
    ]);
    expect(resolveLayers(base.layers, { values: { r2: null }, events: {} }).lines).toHaveLength(1);
  });
});

describe('layer SQL', () => {
  it('computed reference values: one row, the metric compiler aggregates, the chart conditions', () => {
    const q = compileReferenceValues(
      [
        { id: 'r1', computed: { op: 'avg', field: 'SeverityNumber', numeric: true } },
        { id: 'r2', computed: { op: 'count' } },
        { id: 'r3', computed: { op: 'max', field: 'x"); DROP TABLE t; --' } },
      ],
      config,
      [timeCond, "ServiceName = 'payments'"],
      range
    );
    expect(q?.ids).toEqual(['r1', 'r2', 'r3']);
    expect(q?.sql).toContain('avg("SeverityNumber") AS m0');
    expect(q?.sql).toContain('count() AS m1');
    // A hostile field is a quoted identifier, never SQL.
    expect(q?.sql).toContain('max(toFloat64OrNull(toString("x""); DROP TABLE t; --"))) AS m2');
    expect(q?.sql).toContain("WHERE Timestamp >= $__fromTime AND Timestamp <= $__toTime AND ServiceName = 'payments'");
    expect(q?.sql).not.toContain('GROUP BY');
    expect(compileReferenceValues([], config, [], range)).toBeNull();
  });

  it('query annotations: KQL through the search compiler, newest events per query, time conditions only', () => {
    const q = compileAnnotationQuery(
      [
        { id: 'a', query: 'ServiceName : "pay\'ments"' },
        { id: 'b', query: '' },
        { id: 'c', query: 'ServiceName : (' },
      ],
      config,
      [timeCond],
      undefined,
      100
    );
    expect(q?.ids).toEqual(['a', 'b', 'c']);
    const sql = q?.sql ?? '';
    expect(sql).toContain('toUnixTimestamp64Milli(toDateTime64(Timestamp, 3)) AS t');
    expect(sql).toContain("pay\\'ments");
    // Empty query matches everything, invalid KQL nothing.
    expect(sql).toMatch(/if\(1, 1, -1\)/);
    expect(sql).toMatch(/if\(0, 2, -1\)/);
    expect(sql).toContain(`WHERE ${timeCond} AND (`);
    expect(sql).toContain('ORDER BY k, t DESC');
    expect(sql).toContain('LIMIT 100 BY k');
    expect(sql).toContain('LIMIT 300');
    expect(compileAnnotationQuery([], config, [timeCond])).toBeNull();
    const noTime = { ...config, columns: { ...config.columns, timestamp: '' } };
    expect(compileAnnotationQuery([{ id: 'a', query: '' }], noTime, [])).toBeNull();
  });

  it('shapes rows: events per id, values per id (null when missing / not a number)', () => {
    expect(
      shapeAnnotationRows(
        ['a', 'b'],
        [
          { k: 0, t: '2000' },
          { k: '1', t: 1000 },
          { k: 7, t: 1 },
          { k: 0, t: 'x' },
        ]
      )
    ).toEqual({ a: [2000], b: [1000] });
    expect(shapeReferenceRow(['x', 'y', 'z'], { m0: '12.5', m1: null, m2: 'nan' })).toEqual({
      x: 12.5,
      y: null,
      z: null,
    });
    expect(shapeReferenceRow(['x'], undefined)).toEqual({ x: null });
  });
});

describe('XyChart layers', () => {
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
  const H = 3_600_000;
  const t0 = Date.UTC(2026, 0, 5, 8);
  const timeResult: LensResult = {
    xs: [t0, t0 + H, t0 + 2 * H, t0 + 3 * H],
    xLabels: ['', '', '', ''],
    xSynthetic: [false, false, false, false],
    xIsTime: true,
    series: [
      {
        name: 'Count of records',
        points: new Map([
          [t0, 10],
          [t0 + H, 20],
          [t0 + 2 * H, 30],
          [t0 + 3 * H, 5],
        ]),
        metricIndex: 0,
        zeroFill: true,
      },
    ],
    table: { columns: [], rows: [] },
  };
  const line = (over: object = {}) => ({
    id: 'r',
    value: 25,
    text: 'SLO',
    label: 'SLO',
    color: '#ff0000',
    axis: 'left' as const,
    lineStyle: 'solid' as const,
    fill: 'none' as const,
    ...over,
  });

  it('draws a reference line with its label as text, dashed style and fill', () => {
    const { container } = render(
      <XyChart
        chartType="bar"
        result={timeResult}
        bucketMs={H}
        layers={{
          lines: [line({ label: '<img src=x onerror=alert(1)>', text: 'x', lineStyle: 'dashed', fill: 'below' })],
          events: [],
        }}
      />
    );
    const g = screen.getByTestId('lens-reference-line');
    expect(g).toHaveAttribute('data-value', '25');
    expect(g.querySelector('line')).toHaveAttribute('stroke-dasharray', '6 4');
    expect(within(g).getByTestId('lens-reference-fill')).toBeInTheDocument();
    expect(within(g).getByTestId('lens-reference-label').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
  });

  it('widens the value axis to include a line above the data', () => {
    render(
      <XyChart
        chartType="line"
        result={timeResult}
        bucketMs={H}
        layers={{ lines: [line({ value: 900 })], events: [] }}
      />
    );
    const ticks = screen.getAllByTestId('lens-value-tick').map((t) => t.textContent);
    expect(ticks[ticks.length - 1]).toBe('1K');
    const y = Number(screen.getByTestId('lens-reference-line').querySelector('line')?.getAttribute('y1'));
    expect(y).toBeGreaterThan(0);
  });

  it('draws annotation markers on a time axis (point and range), none outside the plot', () => {
    render(
      <XyChart
        chartType="bar"
        result={timeResult}
        bucketMs={H}
        layers={{
          lines: [],
          events: [
            { key: 'p', time: t0 + H, text: 'Deploy', color: '#00f' },
            { key: 'r', time: t0 + 2 * H, end: t0 + 3 * H, text: 'Incident', color: '#00f' },
            { key: 'out', time: t0 + 100 * H, text: 'Later', color: '#00f' },
          ],
        }}
      />
    );
    const marks = screen.getAllByTestId('lens-annotation');
    expect(marks).toHaveLength(2);
    expect(marks[0].getAttribute('aria-label')).toMatch(/^Annotation: Deploy at /);
    expect(marks[1].getAttribute('aria-label')).toMatch(/ to /);
    expect(marks[1].querySelector('rect')).not.toBeNull();
    // The point sits a quarter into the plot (bucket 1 of 4).
    const x = Number(marks[0].querySelector('line')?.getAttribute('x1'));
    const plot = screen.getByTestId('lens-plot-area');
    const left = Number(plot.getAttribute('x'));
    const w = Number(plot.getAttribute('width'));
    expect(x).toBeCloseTo(left + w / 4, 3);
  });

  it('no annotation markers on a category axis', () => {
    render(
      <XyChart
        chartType="bar"
        result={{
          ...timeResult,
          xIsTime: false,
          xs: ['a'],
          series: [{ ...timeResult.series[0], points: new Map([['a', 1]]) }],
        }}
        layers={{ lines: [], events: [{ key: 'p', time: t0, text: 'x', color: '#00f' }] }}
      />
    );
    expect(screen.queryByTestId('lens-annotation')).toBeNull();
  });
});

describe('LayersSection', () => {
  const setup = (layers: ExtraLayer[], timeAxis = true) => {
    const onChange = jest.fn();
    const onEdit = jest.fn();
    render(
      <LayersSection
        layers={layers}
        timeAxis={timeAxis}
        suggestedValue={42}
        suggestedTime={1000}
        onChange={onChange}
        onEdit={onEdit}
      />
    );
    return { onChange, onEdit };
  };

  it('Add layer → Select layer type: Visualization disabled, Annotations need a time axis', () => {
    const { onChange } = setup([], false);
    fireEvent.click(screen.getByRole('button', { name: /Add layer/ }));
    const menu = screen.getByRole('menu', { name: 'Select layer type' });
    expect(within(menu).getByRole('menuitem', { name: /Visualization/ })).toBeDisabled();
    expect(within(menu).getByRole('menuitem', { name: /Annotations/ })).toBeDisabled();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reference lines' }));
    expect(onChange.mock.calls[0][0]).toEqual([{ kind: 'referenceLine', id: expect.any(String), lines: [] }]);
  });

  it('adds an item (static value from the data, manual annotation in the range) and opens it', () => {
    const { onChange, onEdit } = setup([
      { kind: 'referenceLine', id: 'L1', lines: [] },
      { kind: 'annotations', id: 'L2', annotations: [] },
    ]);
    fireEvent.click(screen.getByRole('button', { name: '+ Add reference line' }));
    expect(onChange.mock.calls[0][0][0].lines).toEqual([{ id: expect.any(String), value: 42 }]);
    expect(onEdit).toHaveBeenCalledWith({ layerId: 'L1', itemId: onChange.mock.calls[0][0][0].lines[0].id });
    fireEvent.click(screen.getByRole('button', { name: '+ Add annotation' }));
    expect(onChange.mock.calls[1][0][1].annotations).toEqual([{ id: expect.any(String), type: 'manual', time: 1000 }]);
  });

  it('layer actions: Duplicate, Clear, Remove; items can be removed or edited', () => {
    const { onChange, onEdit } = setup([refLayer]);
    const card = screen.getByRole('group', { name: 'Reference lines layer' });
    fireEvent.click(within(card).getByRole('button', { name: 'Edit SLO' }));
    expect(onEdit).toHaveBeenCalledWith({ layerId: 'L1', itemId: 'r1' });
    fireEvent.click(within(card).getByRole('button', { name: 'Remove Average of SeverityNumber' }));
    expect(onChange.mock.calls[0][0][0].lines.map((l: { id: string }) => l.id)).toEqual(['r1']);
    const act = (name: string) => {
      fireEvent.click(within(card).getByRole('button', { name: 'Layer actions for Reference lines' }));
      fireEvent.click(screen.getByRole('menuitem', { name }));
      return onChange.mock.calls[onChange.mock.calls.length - 1][0];
    };
    expect(act('Duplicate layer')).toHaveLength(2);
    expect(act('Clear layer')[0].lines).toEqual([]);
    expect(act('Remove layer')).toEqual([]);
  });
});

describe('LayerItemEditor', () => {
  beforeAll(() => {
    // Combobox measures its text on a canvas, which jsdom does not have.
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  const fields: LensField[] = [
    { id: 'n', sqlExpr: 'SeverityNumber', label: 'SeverityNumber', type: 'number' },
    { id: 's', sqlExpr: 'ServiceName', label: 'ServiceName', type: 'string' },
  ];
  const setup = (layers: ExtraLayer[], itemId: string, layerId = layers[0].id) => {
    const onChange = jest.fn();
    const onBack = jest.fn();
    render(
      <LayerItemEditor
        layers={layers}
        target={{ layerId, itemId }}
        fields={fields}
        canUseRightAxis
        suggestedTime={5000}
        onChange={onChange}
        onBack={onBack}
      />
    );
    const last = () => onChange.mock.calls[onChange.mock.calls.length - 1][0];
    return { onChange, onBack, last };
  };

  it('static value: applied on Enter when a number, refused otherwise; style, fill, axis, label', () => {
    const { onChange, last, onBack } = setup([refLayer], 'r1');
    const box = screen.getByRole('textbox', { name: 'Reference line value' });
    fireEvent.change(box, { target: { value: 'abc' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('Enter a number')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: '250' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(last()[0].lines[0]).toMatchObject({ id: 'r1', value: 250 });
    fireEvent.click(screen.getByRole('radio', { name: 'Dotted' }));
    expect(last()[0].lines[0].lineStyle).toBe('dotted');
    fireEvent.click(screen.getByRole('radio', { name: 'None' }));
    expect(last()[0].lines[0].fill).toBeUndefined();
    fireEvent.click(screen.getByRole('radio', { name: 'Right' }));
    expect(last()[0].lines[0].axis).toBe('right');
    fireEvent.change(screen.getByRole('textbox', { name: 'Label' }), { target: { value: 'Target' } });
    expect(last()[0].lines[0].label).toBe('Target');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('Computed picks a compatible field (count when none fits); Static goes back', () => {
    const { last } = setup([{ kind: 'referenceLine', id: 'L', lines: [{ id: 'x', value: 1 }] }], 'x');
    fireEvent.click(screen.getByRole('radio', { name: 'Computed' }));
    expect(last()[0].lines[0].computed).toEqual({
      op: 'avg',
      field: 'SeverityNumber',
      fieldLabel: 'SeverityNumber',
      numeric: true,
    });
  });

  it('a computed line goes back to a static value', () => {
    const { last } = setup([refLayer], 'r2');
    expect(screen.getByText('Function')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Static value' }));
    expect(last()[0].lines[1].computed).toBeUndefined();
  });

  it('annotations: date and range validated, query type checks KQL before storing', () => {
    const { onChange, last } = setup([annLayer], 'a1');
    const date = screen.getByRole('textbox', { name: 'Annotation date' });
    fireEvent.change(date, { target: { value: 'tomorrow' } });
    fireEvent.blur(date);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(date, { target: { value: '2026-01-05 10:00' } });
    fireEvent.blur(date);
    expect(last()[0].annotations[0].time).toBe(parseAnnotationTime('2026-01-05 10:00'));
    const end = screen.getByRole('textbox', { name: 'End date (range, optional)' });
    fireEvent.change(end, { target: { value: '2000-01-01' } });
    expect(screen.getByText('The end must be after the start')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'Query' }));
    expect(last()[0].annotations[0]).toEqual({ id: 'a1', type: 'query', query: '', label: 'Incident' });
  });

  it('query annotation: invalid KQL is not stored', () => {
    const { onChange, last } = setup([annLayer], 'a2');
    const q = screen.getByRole('textbox', { name: 'Query (KQL)' });
    fireEvent.change(q, { target: { value: 'ServiceName : (' } });
    fireEvent.blur(q);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(q, { target: { value: 'ServiceName : payments' } });
    fireEvent.blur(q);
    expect(last()[0].annotations[1].query).toBe('ServiceName : payments');
    fireEvent.click(screen.getByRole('radio', { name: 'Static date' }));
    expect(last()[0].annotations[1]).toEqual({ id: 'a2', type: 'manual', time: 5000 });
  });

  it('helpers: time parsing and KQL errors', () => {
    expect(parseAnnotationTime('2026-01-05')).toBe(dateTime('2026-01-05', 'YYYY-MM-DD').valueOf());
    expect(parseAnnotationTime('2026-01-05 09:00:30')).toBeDefined();
    expect(parseAnnotationTime('2026-13-45')).toBeUndefined();
    expect(parseAnnotationTime('1 day ago')).toBeUndefined();
    expect(kqlError('a : b')).toBeUndefined();
    expect(kqlError('a : (')).toBeDefined();
    expect(kqlError('x'.repeat(1001))).toMatch(/Max/);
  });
});

describe('Grafana export (thresholds)', () => {
  it('static left-axis lines become threshold lines; computed and right-axis lines are not exported', () => {
    const state: LensState = {
      ...base,
      metrics: [...base.metrics, { kind: 'metric', id: 'm1', op: 'count', axis: 'right' }],
      layers: [
        {
          kind: 'referenceLine',
          id: 'L',
          lines: [
            { id: 'a', value: 500, color: '#00ff00', lineStyle: 'dashed', fill: 'above' },
            { id: 'b', value: 100, lineStyle: 'dotted', fill: 'above' },
            { id: 'c', value: 50, axis: 'right' },
            { id: 'd', value: 0, computed: { op: 'count' } },
          ],
        },
        annLayer,
      ],
    };
    expect(exportableLines(state).map((l) => l.id)).toEqual(['a', 'b']);
    const panel = buildLensPanel(state, config, [timeCond], range, { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } });
    const defaults = panel.fieldConfig?.defaults as Record<string, any>;
    expect(defaults.thresholds).toEqual({
      mode: 'absolute',
      steps: [
        { color: 'transparent', value: null },
        { color: '#e02f44', value: 100 },
        { color: '#00ff00', value: 500 },
      ],
    });
    expect(defaults.custom.thresholdsStyle).toEqual({ mode: 'dashed+area' });
    // The panel's other settings stay.
    expect(defaults.custom.drawStyle).toBe('bars');
    // Annotations are not exported: nothing about them in the panel.
    expect(JSON.stringify(panel)).not.toContain('Incident');
  });

  it('mixed styles → solid lines without area; no exportable line → unchanged', () => {
    const parts = { options: {}, fieldConfig: { defaults: { custom: { a: 1 } }, overrides: [] } };
    const mixed: LensState = {
      ...base,
      layers: [
        {
          kind: 'referenceLine',
          id: 'L',
          lines: [
            { id: 'a', value: 1, lineStyle: 'dashed' },
            { id: 'b', value: 2 },
          ],
        },
      ],
    };
    expect((withReferenceThresholds(parts, mixed).fieldConfig.defaults.custom as any).thresholdsStyle).toEqual({
      mode: 'line',
    });
    expect(withReferenceThresholds(parts, { ...base, layers: [annLayer] })).toBe(parts);
    expect(withReferenceThresholds(parts, { ...base, layers: undefined })).toBe(parts);
  });
});
