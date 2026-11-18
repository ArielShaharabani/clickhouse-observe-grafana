import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { panelSpec } from '../render/LensChart';
import { buildLensPanel } from '../panelExport';
import { withMetricAppearance } from '../render/fieldConfig';
import { XyChart } from '../render/XyChart';
import { MetricAdvanced } from '../MetricAdvanced';
import { LensResult, shapeLensRows } from '../compile';
import { LensState, MetricDim } from '../state';
import { dateTime } from '@grafana/data';
import { OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

jest.mock('@grafana/runtime', () => ({ ...jest.requireActual('@grafana/runtime'), PanelRenderer: () => null }));

const date = {
  kind: 'date_histogram' as const,
  id: 'b0',
  field: 'Timestamp',
  label: 'Timestamp',
  interval: 'auto' as const,
};
const svc = { kind: 'terms' as const, id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 };
const count: MetricDim = { kind: 'metric', id: 'm0', op: 'count' };
const avg: MetricDim = {
  kind: 'metric',
  id: 'm1',
  op: 'avg',
  field: 'SeverityNumber',
  fieldLabel: 'SeverityNumber',
  numeric: true,
};

describe('appearance as Grafana field config', () => {
  it('one metric: defaults get unit, decimals, fixed colour and axis placement', () => {
    const state: LensState = {
      chartType: 'line',
      buckets: [date],
      metrics: [{ ...count, format: { id: 'bytes', decimals: 1 }, color: '#112233', axis: 'right' }],
    };
    const fc = withMetricAppearance({ defaults: { custom: { lineWidth: 2 } }, overrides: [] }, state, true);
    expect(fc.defaults).toEqual({
      custom: { lineWidth: 2, axisPlacement: 'right' },
      unit: 'bytes',
      decimals: 1,
      color: { mode: 'fixed', fixedColor: '#112233' },
    });
  });

  it('several metrics: one override per metric, matched by label; no colour with a breakdown', () => {
    const state: LensState = {
      chartType: 'line',
      buckets: [date, svc],
      metrics: [count, { ...avg, format: { id: 'percent' }, color: '#112233' }],
    };
    const fc = withMetricAppearance({ defaults: {}, overrides: [] }, state, true);
    expect(fc.overrides).toEqual([
      {
        matcher: { id: 'byRegexp', options: '^(.* · )?Average of SeverityNumber$' },
        properties: [{ id: 'unit', value: 'percentunit' }],
      },
    ]);
  });

  it('table / metric panels and exported dashboard panels carry the format', () => {
    const state: LensState = { chartType: 'metric', buckets: [], metrics: [{ ...count, format: { id: 'bytes' } }] };
    expect(panelSpec(state, shapeLensRows(state, [{ m0: 3 }])).fieldConfig.defaults).toMatchObject({ unit: 'bytes' });
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
    );
    expect(panel.fieldConfig?.defaults).toMatchObject({ unit: 'bytes' });
  });
});

describe('XyChart appearance', () => {
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

  const result: LensResult = {
    xs: ['a', 'b'],
    xLabels: ['a', 'b'],
    xSynthetic: [false, false],
    xIsTime: false,
    series: [
      {
        name: 'Count of records',
        points: new Map([
          ['a', 10],
          ['b', 20],
        ]),
        metricIndex: 0,
        zeroFill: true,
      },
      {
        name: 'Average of SeverityNumber',
        points: new Map([
          ['a', 0.5],
          ['b', 0.25],
        ]),
        metricIndex: 1,
        zeroFill: false,
      },
    ],
    table: { columns: [], rows: [] },
  };

  it('uses the metric colour and format, and draws a right axis', () => {
    render(
      <XyChart
        chartType="line"
        result={result}
        metrics={[
          { ...count, color: '#123456' },
          { ...avg, format: { id: 'percent', decimals: 0 }, axis: 'right' },
        ]}
      />
    );
    expect(screen.getAllByLabelText(/^a · Average of SeverityNumber: 50%$/)).toHaveLength(1);
    expect(screen.getAllByTestId('lens-right-tick').length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('lens-right-tick').some((t) => /%$/.test(t.textContent ?? ''))).toBe(true);
    const swatch = screen.getByText('Count of records').querySelector('span') as HTMLElement;
    expect(swatch.style.background).toBe('rgb(18, 52, 86)');
  });
});

describe('MetricAdvanced editor', () => {
  beforeAll(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }), font: '' })) as never;
  });
  const chart: LensState = { chartType: 'line', buckets: [date], metrics: [count] };

  it('applies a valid Filter by and rejects invalid KQL', () => {
    const onChange = jest.fn();
    render(<MetricAdvanced dim={count} chart={chart} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    const box = screen.getByLabelText('Filter by');
    fireEvent.change(box, { target: { value: 'a : (' } });
    fireEvent.blur(box);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'SeverityText : ERROR' } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenLastCalledWith({ ...count, filter: 'SeverityText : ERROR' });
  });

  it('time shift: preset buttons and typed values; garbage is not applied', () => {
    const onChange = jest.fn();
    render(<MetricAdvanced dim={count} chart={chart} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Time shift 1w' }));
    expect(onChange).toHaveBeenLastCalledWith({ ...count, shift: '1w' });
    const box = screen.getByLabelText('Time shift');
    fireEvent.change(box, { target: { value: "1d' OR 1=1" } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.change(box, { target: { value: '2d' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith({ ...count, shift: '2d' });
  });

  it('reduced time range is disabled with a date histogram; normalize needs one', () => {
    const onChange = jest.fn();
    const { rerender } = render(<MetricAdvanced dim={count} chart={chart} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByLabelText('Reduced time range')).toBeDisabled();
    fireEvent.click(screen.getByLabelText('per hour'));
    expect(onChange).toHaveBeenLastCalledWith({ ...count, normalize: 'h' });
    rerender(
      <MetricAdvanced dim={count} chart={{ chartType: 'metric', buckets: [], metrics: [count] }} onChange={onChange} />
    );
    expect(screen.getByLabelText('Reduced time range')).not.toBeDisabled();
  });

  it('formula metrics point to the formula arguments instead', () => {
    const f: MetricDim = { kind: 'metric', id: 'f', op: 'formula', formula: 'count()', formulaFields: {} };
    render(<MetricAdvanced dim={f} chart={chart} onChange={jest.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.queryByLabelText('Filter by')).toBeNull();
    expect(screen.getByText(/count\(kql=/)).toBeInTheDocument();
  });
});
