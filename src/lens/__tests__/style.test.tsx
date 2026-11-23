import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LensResult } from '../compile';
import { queryShape } from '../dimensions';
import { buildLensPanel } from '../panelExport';
import { XyChart } from '../render/XyChart';
import { autoAxisTitles, legendOptions, withLensStyle } from '../render/styleConfig';
import { decodeLens, encodeLens, LensState } from '../state';
import {
  axisTitle,
  cleanStyle,
  legendOf,
  legendVisible,
  scalePos,
  tickRotation,
  valueDomain,
  valueTicks,
  tickStep,
} from '../style';
import { StylePanel } from '../StylePanel';
import { switchChart } from '../suggest';
import { SourceConfig } from '../../types';
import { getDefaultTimeRange } from '@grafana/data';

describe('cleanStyle (untrusted URL / saved chart input)', () => {
  it('keeps known keys and values only', () => {
    expect(
      cleanStyle({
        orientation: 'horizontal',
        barValues: 'show',
        evil: '"; DROP TABLE x',
        left: { title: 'custom', titleText: 'Errors', scale: 'log', bounds: 'custom', min: 1, max: 100, junk: 1 },
        bottom: { orientation: 'angled', gridlines: true, scale: 'log', bounds: 'custom', min: 0 },
        legend: { visibility: 'show', position: 'inside', alignment: 'bottom-left', layout: 'grid', x: 1 },
      })
    ).toEqual({
      orientation: 'horizontal',
      barValues: 'show',
      left: { title: 'custom', titleText: 'Errors', scale: 'log', bounds: 'custom', min: 1, max: 100 },
      // The category axis has no scale or bounds.
      bottom: { orientation: 'angled', gridlines: true },
      legend: { visibility: 'show', position: 'inside', alignment: 'bottom-left', layout: 'grid' },
    });
  });

  it('drops bad values, inverted bounds, non-finite numbers and over-long titles', () => {
    expect(cleanStyle({ orientation: 'diagonal', barValues: 1, legend: { visibility: 'sometimes' } })).toBeUndefined();
    expect(cleanStyle({ left: { bounds: 'custom', min: 5, max: 1 } })).toEqual({ left: { bounds: 'custom' } });
    expect(cleanStyle({ left: { bounds: 'custom', min: Infinity, max: 'x' } })).toEqual({ left: { bounds: 'custom' } });
    expect(cleanStyle({ left: { title: 'custom', titleText: 'x'.repeat(500) } })?.left?.titleText).toHaveLength(120);
    // A title text without the Custom mode is not kept.
    expect(cleanStyle({ left: { title: 'auto', titleText: 'x' } })).toEqual({ left: { title: 'auto' } });
    // An inside corner is not an outside side (and vice versa).
    expect(cleanStyle({ legend: { position: 'outside', alignment: 'top-left' } })).toEqual({
      legend: { position: 'outside' },
    });
    expect(cleanStyle(null)).toBeUndefined();
    expect(cleanStyle([1])).toBeUndefined();
  });

  it('round-trips through the lens URL codec; unknown style input is dropped', () => {
    const s: LensState = {
      chartType: 'bar',
      subType: 'stacked',
      buckets: [],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
      style: { orientation: 'horizontal', legend: { visibility: 'hide' } },
    };
    expect(decodeLens(encodeLens(s))).toEqual(s);
    const hostile = JSON.stringify({ ...s, style: { orientation: '<script>', left: { min: 'x' } } });
    expect(decodeLens(hostile)?.style).toBeUndefined();
  });

  it('is display-only: the query key ignores it, and XY chart switches keep it', () => {
    const s: LensState = {
      chartType: 'bar',
      buckets: [],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
      style: { barValues: 'show' },
    };
    expect(queryShape(s).style).toBeUndefined();
    const ctx = { fields: [], timeField: undefined } as unknown as Parameters<typeof switchChart>[2];
    expect(switchChart(s, 'line', ctx).style).toEqual({ barValues: 'show' });
    expect(switchChart(s, 'table', ctx).style).toBeUndefined();
  });
});

describe('style helpers', () => {
  it('legend defaults reproduce the old chart (below, list) and Auto hides a lone series', () => {
    expect(legendOf(undefined)).toEqual({
      visibility: 'auto',
      position: 'outside',
      alignment: 'bottom',
      layout: 'list',
    });
    expect(legendOf({ legend: { position: 'inside' } }).alignment).toBe('top-right');
    expect(legendVisible(undefined, 1, false)).toBe(false);
    expect(legendVisible(undefined, 1, true)).toBe(true);
    expect(legendVisible(undefined, 2, false)).toBe(true);
    expect(legendVisible({ legend: { visibility: 'show' } }, 1, false)).toBe(true);
    expect(legendVisible({ legend: { visibility: 'hide' } }, 5, true)).toBe(false);
  });

  it('axis titles: none, custom text or the automatic one', () => {
    expect(axisTitle(undefined, 'left', 'Count of records')).toBe('Count of records');
    expect(axisTitle({ left: { title: 'none' } }, 'left', 'Count')).toBe('');
    expect(axisTitle({ left: { title: 'custom', titleText: 'Hits' } }, 'left', 'Count')).toBe('Hits');
    expect(tickRotation('angled')).toBe(-45);
    expect(tickRotation('vertical')).toBe(-90);
  });

  it('value domains: full includes zero, data hugs the data, custom wins, log is positive', () => {
    expect(valueDomain(20, 87, { bounds: 'full' })).toEqual([0, 100]);
    expect(valueDomain(20, 87, { bounds: 'data' })).toEqual([20, 90]);
    expect(valueDomain(20, 87, { bounds: 'data', nice: false })).toEqual([20, 87]);
    expect(valueDomain(20, 87, { bounds: 'custom', min: 10, max: 50 })).toEqual([10, 50]);
    expect(valueDomain(-30, 87, { bounds: 'full' })).toEqual([-40, 100]);
    // Kibana parity: a 140 peak gives 0–140 (not 200), 420 → 500, counts never get fractional steps.
    expect(valueDomain(0, 140, {})).toEqual([0, 140]);
    expect(valueDomain(0, 120, {})).toEqual([0, 120]);
    expect(valueDomain(0, 420, {})).toEqual([0, 500]);
    expect(valueDomain(0, 5, {}, false, { integer: true })).toEqual([0, 5]);
    expect(valueDomain(0, 870, { scale: 'log' })).toEqual([1, 1000]);
    expect(valueDomain(3, 870, { scale: 'log' })).toEqual([1, 1000]);
    expect(valueDomain(0, 40, {}, true)).toEqual([0, 100]);
  });

  it('scales and ticks', () => {
    expect(scalePos(50, 0, 100, 'linear')).toBe(0.5);
    expect(scalePos(10, 1, 100, 'log')).toBeCloseTo(0.5);
    expect(scalePos(25, 0, 100, 'sqrt')).toBeCloseTo(0.5);
    // Log: values ≤ 0 sit at the bottom instead of NaN.
    expect(scalePos(0, 1, 100, 'log')).toBe(0);
    expect(valueTicks(1, 1000, 'log')).toEqual([1, 10, 100, 1000]);
    expect(valueTicks(0, 100, 'linear')).toEqual([0, 20, 40, 60, 80, 100]);
    expect(valueTicks(0, 140, 'linear')).toEqual([0, 20, 40, 60, 80, 100, 120, 140]);
    expect(valueTicks(0, 500, 'linear')).toEqual([0, 100, 200, 300, 400, 500]);
    // No 1.25 on a count axis.
    expect(valueTicks(0, 5, 'linear', { integer: true })).toEqual([0, 1, 2, 3, 4, 5]);
    expect(valueTicks(0, 2, 'linear', { integer: true })).toEqual([0, 1, 2]);
    expect(valueTicks(0, 0.3, 'linear')).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3]);
    expect(tickStep(0, 140)).toBe(20);
    expect(tickStep(0, 2, 6, true)).toBe(1);
    expect(valueTicks(0, 100, 'sqrt')[2]).toBeCloseTo(25);
  });
});

describe('XyChart with a style', () => {
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

  const one: LensResult = {
    xs: ['a', 'b'],
    xLabels: ['a', 'b'],
    xSynthetic: [false, false],
    xIsTime: false,
    series: [
      {
        name: 'Count of records',
        points: new Map([
          ['a', 12],
          ['b', 3],
        ]),
        metricIndex: 0,
        zeroFill: true,
      },
    ],
    table: { columns: [], rows: [] },
  };
  const two: LensResult = {
    ...one,
    series: [
      {
        name: 'error',
        points: new Map([
          ['a', 12],
          ['b', 3],
        ]),
        breakdown: 'error',
        metricIndex: 0,
        zeroFill: true,
      },
      {
        name: 'info',
        points: new Map([
          ['a', 4],
          ['b', 9],
        ]),
        breakdown: 'info',
        metricIndex: 0,
        zeroFill: true,
      },
    ],
  };
  const titles = { left: 'Count of records', bottom: 'Top values of ServiceName', right: '' };

  it('defaults: automatic axis titles, legend hidden for a lone series, shown with a breakdown', () => {
    const { container, rerender } = render(<XyChart chartType="bar" result={one} axisTitles={titles} />);
    expect(screen.getByTestId('lens-axis-title-left')).toHaveTextContent('Count of records');
    expect(screen.getByTestId('lens-axis-title-bottom')).toHaveTextContent('Top values of ServiceName');
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
    expect(container.querySelector('[data-orientation]')).toHaveAttribute('data-orientation', 'vertical');
    rerender(<XyChart chartType="bar" result={two} axisTitles={titles} />);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveAttribute('data-legend-alignment', 'bottom');
  });

  it('horizontal bars: bars run along x from the left edge of the plot', () => {
    render(<XyChart chartType="bar" result={one} style={{ orientation: 'horizontal' }} axisTitles={titles} />);
    expect(screen.getByTestId('lens-xy')).toHaveAttribute('data-orientation', 'horizontal');
    const bars = screen.getAllByRole('button', { name: /Count of records: / });
    const [a, b] = bars.map((r) => ({ w: Number(r.getAttribute('width')), h: Number(r.getAttribute('height')) }));
    // 12 vs 3: widths carry the value, heights are equal bands.
    expect(a.w).toBeGreaterThan(b.w * 3.5);
    expect(a.h).toBe(b.h);
  });

  it('bar values show where they fit; titles, gridlines and tick labels can be turned off', () => {
    render(
      <XyChart
        chartType="bar"
        result={one}
        axisTitles={titles}
        style={{
          barValues: 'show',
          left: { title: 'none', ticks: false, gridlines: false },
          bottom: { title: 'custom', titleText: 'Service' },
        }}
      />
    );
    expect(screen.getAllByTestId('lens-bar-value').map((t) => t.textContent)).toEqual(['12', '3']);
    expect(screen.queryByTestId('lens-axis-title-left')).toBeNull();
    expect(screen.getByTestId('lens-axis-title-bottom')).toHaveTextContent('Service');
    expect(screen.queryAllByTestId('lens-value-tick')).toHaveLength(0);
  });

  it('log scale ticks are powers of ten; custom bounds set the axis', () => {
    const { rerender } = render(<XyChart chartType="line" result={one} style={{ left: { scale: 'log' } }} />);
    expect(screen.getAllByTestId('lens-value-tick').map((t) => t.textContent)).toEqual(['1', '10', '100']);
    rerender(<XyChart chartType="line" result={one} style={{ left: { bounds: 'custom', min: 0, max: 40 } }} />);
    const ticks = screen.getAllByTestId('lens-value-tick').map((t) => t.textContent);
    expect(ticks[0]).toBe('0');
    expect(ticks[ticks.length - 1]).toBe('40');
  });

  it('legend: show / hide, right side, inside corner, grid layout', () => {
    const { rerender } = render(
      <XyChart
        chartType="bar"
        result={one}
        style={{ legend: { visibility: 'show', alignment: 'right', layout: 'grid' } }}
      />
    );
    const lg = screen.getByRole('list', { name: 'Legend' });
    expect(lg).toHaveAttribute('data-legend-alignment', 'right');
    expect(lg).toHaveAttribute('data-legend-layout', 'grid');
    rerender(
      <XyChart chartType="bar" result={two} style={{ legend: { position: 'inside', alignment: 'bottom-left' } }} />
    );
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveAttribute('data-legend-position', 'inside');
    rerender(<XyChart chartType="bar" result={two} style={{ legend: { visibility: 'hide' } }} />);
    expect(screen.queryByRole('list', { name: 'Legend' })).toBeNull();
  });
});

describe('StylePanel', () => {
  it('bar orientation, bar values and legend changes go through cleanStyle', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <StylePanel
        view="style"
        chartType="bar"
        style={undefined}
        hasRightAxis={false}
        onChange={onChange}
        onBack={() => {}}
      />
    );
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Bar orientation' })).getByText('Horizontal'));
    expect(onChange).toHaveBeenLastCalledWith({ orientation: 'horizontal' });
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Bar values' })).getByText('Show, if able'));
    expect(onChange).toHaveBeenLastCalledWith({ barValues: 'show' });

    rerender(
      <StylePanel
        view="legend"
        chartType="bar"
        style={undefined}
        hasRightAxis={false}
        onChange={onChange}
        onBack={() => {}}
      />
    );
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Position' })).getByText('Inside'));
    expect(onChange).toHaveBeenLastCalledWith({ legend: { position: 'inside', alignment: 'top-right' } });
  });

  it('horizontal bars relabel the axes; Data bounds are disabled for bars; Back returns', () => {
    const onBack = jest.fn();
    render(
      <StylePanel
        view="style"
        chartType="bar"
        style={{ orientation: 'horizontal' }}
        hasRightAxis={false}
        onChange={() => {}}
        onBack={onBack}
      />
    );
    // The value axis ("left" by role) is drawn at the bottom.
    expect(within(screen.getByRole('region', { name: 'Bottom axis' })).getByText('Axis scale')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Left axis' })).queryByText('Axis scale')).toBeNull();
    const data = within(screen.getByRole('radiogroup', { name: 'Bounds' })).getByLabelText('Data');
    expect(data).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('custom bounds: the lower bound must stay below the upper one, and junk is not applied', () => {
    const onChange = jest.fn();
    render(
      <StylePanel
        view="style"
        chartType="line"
        style={{ left: { bounds: 'custom', max: 10 } }}
        hasRightAxis={false}
        onChange={onChange}
        onBack={() => {}}
      />
    );
    const lower = screen.getByLabelText('Lower bound');
    fireEvent.change(lower, { target: { value: '50' } });
    fireEvent.blur(lower);
    expect(screen.getByText('The lower bound must be below the upper bound')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(lower, { target: { value: 'abc' } });
    fireEvent.blur(lower);
    expect(screen.getByText('Enter a number')).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(lower, { target: { value: '2' } });
    fireEvent.blur(lower);
    expect(onChange).toHaveBeenLastCalledWith({ left: { bounds: 'custom', min: 2, max: 10 } });
  });
});

describe('Grafana panels (exported dashboard panel)', () => {
  const state: LensState = {
    chartType: 'bar',
    subType: 'unstacked',
    buckets: [{ kind: 'terms', id: 'b', field: 'ServiceName', label: 'ServiceName', size: 5 }],
    metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
    style: {
      orientation: 'horizontal',
      barValues: 'show',
      left: { title: 'custom', titleText: 'Hits', scale: 'log', bounds: 'custom', min: 1, max: 1000, gridlines: false },
      bottom: { orientation: 'angled' },
      legend: { alignment: 'right' },
    },
  };

  it('maps style to barchart options and field config', () => {
    const config = {
      datasourceUid: 'ch',
      database: 'default',
      logsTable: 'logs',
      columns: { timestamp: 'Timestamp' },
    } as unknown as SourceConfig;
    const p = buildLensPanel(state, config, [], getDefaultTimeRange(), { id: 1, gridPos: { x: 0, y: 0, w: 12, h: 8 } });
    expect(p.type).toBe('barchart');
    expect(p.options).toMatchObject({
      orientation: 'horizontal',
      showValue: 'auto',
      xTickLabelRotation: -45,
      legend: { showLegend: true, placement: 'right' },
    });
    expect(p.fieldConfig?.defaults).toMatchObject({
      min: 1,
      max: 1000,
      custom: { axisLabel: 'Hits', axisGridShow: false, scaleDistribution: { type: 'log', log: 10 } },
    });
  });

  it('no style → panel unchanged; legend hide → showLegend false', () => {
    const parts = { options: { a: 1 }, fieldConfig: { defaults: {}, overrides: [] } };
    expect(withLensStyle(parts, { ...state, style: undefined }, 'barchart', { left: '', bottom: '' })).toEqual({
      options: parts.options,
      fieldConfig: { defaults: { custom: { axisSoftMin: 0 } }, overrides: [] },
    });
    expect(legendOptions({ legend: { visibility: 'hide' } })).toMatchObject({ showLegend: false });
    expect(autoAxisTitles(state)).toEqual({ left: 'Count of records', right: '', bottom: expect.any(String) });
  });
});
