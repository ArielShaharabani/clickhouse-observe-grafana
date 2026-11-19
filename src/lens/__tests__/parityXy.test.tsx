/**
 * Kibana-parity fixes for the Visualize XY chart (docs/dev/pending/PARITY-XYCHART.md): crosshair
 * tooltip, line without stacking, brush from a bar, stable series colours and legend order, nice
 * value ticks, round time ticks, plain lines, number formatting, legend colour picker.
 */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { LensResult, LensSeries, orderSeries, shapeLensRows } from '../compile';
import { queryShape } from '../dimensions';
import { brushSeconds, formatAxisNumber, formatNumber, toHex, XyChart } from '../render/XyChart';
import { assignColorSlots, hashString, seriesColorKey } from '../render/seriesColors';
import { timeStep, timeTicks } from '../render/timeTicks';
import { autoAxisTitles } from '../render/styleConfig';
import { panelSpec } from '../render/LensChart';
import { buildLensPanel } from '../panelExport';
import { cleanStyle, MAX_SERIES_COLORS, seriesColorOf, withSeriesColor } from '../style';
import { decodeLens, encodeLens, LensState } from '../state';
import { chartTitle } from '../suggest';
import { SourceConfig, OTEL_COLUMN_MAPPING } from '../../types';

const H = 3_600_000;

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

const series = (
  name: string,
  pts: Array<[string | number, number]>,
  breakdown: string | undefined = name
): LensSeries => ({
  name,
  points: new Map(pts),
  breakdown,
  metricIndex: 0,
  zeroFill: true,
});

const cats: LensResult = {
  xs: ['a', 'b'],
  xLabels: ['a', 'b'],
  xSynthetic: [false, false],
  xIsTime: false,
  series: [
    series('payments', [
      ['a', 12_345],
      ['b', 10],
    ]),
    series('auth', [
      ['a', 300],
      ['b', 20],
    ]),
  ],
  table: { columns: [], rows: [] },
};

const t0 = new Date(2026, 0, 5, 6, 0).getTime();
const timeResult: LensResult = {
  xs: [t0, t0 + H, t0 + 2 * H, t0 + 3 * H],
  xLabels: ['', '', '', ''],
  xSynthetic: [false, false, false, false],
  xIsTime: true,
  series: [
    series('info', [
      [t0, 85],
      [t0 + H, 90],
      [t0 + 2 * H, 85],
      [t0 + 3 * H, 80],
    ]),
    series('error', [
      [t0, 10],
      [t0 + H, 305],
      [t0 + 2 * H, 12],
      [t0 + 3 * H, 9],
    ]),
  ],
  table: { columns: [], rows: [] },
};

const svgOf = () => screen.getByRole('group', { name: /chart$/ });

describe('crosshair tooltip (item 1)', () => {
  it('hovering lists every series at that X, values with separators, the hovered series highlighted', () => {
    render(<XyChart chartType="bar" subType="stacked" result={cats} />);
    // Plot: x 52…592 (two bands of 270), y 8…272; the first band's stack bottom is payments.
    fireEvent.mouseMove(svgOf(), { clientX: 187, clientY: 260 });
    const tip = screen.getByTestId('lens-tooltip');
    expect(tip).toHaveTextContent('a');
    const rows = within(tip).getAllByTestId('lens-tooltip-row');
    expect(rows.map((r) => r.textContent)).toEqual(['payments12,345', 'auth300']);
    expect(rows[0]).toHaveAttribute('data-highlighted', 'true');
    expect(rows[1]).not.toHaveAttribute('data-highlighted');
    fireEvent.mouseLeave(svgOf());
    expect(screen.queryByTestId('lens-tooltip')).toBeNull();
  });

  it('a time X shows the full date and time; keyboard focus on a mark shows the tooltip too', () => {
    render(<XyChart chartType="bar" result={timeResult} bucketMs={H} />);
    const mark = screen.getByRole('button', { name: /error: 305$/ });
    act(() => mark.focus());
    const tip = screen.getByTestId('lens-tooltip');
    expect(tip).toHaveTextContent('Jan 5, 2026 @ 07:00');
    expect(within(tip).getAllByTestId('lens-tooltip-row')[1]).toHaveAttribute('data-highlighted', 'true');
    act(() => mark.blur());
    expect(screen.queryByTestId('lens-tooltip')).toBeNull();
  });

  it('marks have no native title (the tooltip replaces it) but keep their accessible names', () => {
    const { container } = render(<XyChart chartType="bar" result={cats} />);
    expect(container.querySelectorAll('title')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'a · payments: 12,345' })).toBeInTheDocument();
  });
});

describe('line has no stacking (item 2)', () => {
  it('draws line series unstacked whatever sub-type is stored', () => {
    const { container, rerender } = render(<XyChart chartType="line" subType="percentage" result={timeResult} />);
    const ticks = () => screen.getAllByTestId('lens-value-tick').map((t) => t.textContent ?? '');
    expect(ticks().some((t) => t.includes('%'))).toBe(false);
    const cy = () => Number(container.querySelector('[aria-label$="error: 305"]')?.getAttribute('cy'));
    const unstacked = cy();
    rerender(<XyChart chartType="line" subType="stacked" result={timeResult} />);
    expect(cy()).toBe(unstacked);
    // Area still stacks: error sits on top of info there.
    rerender(<XyChart chartType="area" subType="stacked" result={timeResult} />);
    expect(cy()).toBeLessThan(unstacked);
  });

  it('old URLs with line + stacked still load; the title and Grafana panels show a plain line', () => {
    const s: LensState = {
      chartType: 'line',
      subType: 'stacked',
      buckets: [{ kind: 'date_histogram', id: 'x', field: 'Timestamp', label: 'Timestamp', interval: 'auto' }],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
    };
    const decoded = decodeLens(encodeLens(s))!;
    expect(decoded.chartType).toBe('line');
    expect(decoded.subType).toBe('stacked');
    expect(chartTitle({ ...decoded, subType: 'percentage' })).toBe('Line');
    const spec = panelSpec({ ...decoded, subType: 'percentage' }, timeResult);
    expect((spec.fieldConfig.defaults.custom as any).stacking.mode).toBe('none');
    const config: SourceConfig = {
      datasourceUid: 'ds',
      database: 'default',
      logsTable: 'spec_logs',
      isOtel: true,
      sequentialConsistency: false,
      columns: { ...OTEL_COLUMN_MAPPING },
    };
    const tr = { from: dateTime(t0), to: dateTime(t0 + 4 * H), raw: { from: dateTime(t0), to: dateTime(t0 + 4 * H) } };
    const panel = buildLensPanel({ ...decoded, subType: 'percentage' }, config, [], tr, { title: 't' } as any);
    expect(JSON.stringify(panel)).not.toContain('"percent"');
  });
});

describe('brush from a bar (item 3)', () => {
  it('a drag that starts on a bar brushes; the click ending it does not open the chooser', () => {
    const onBrush = jest.fn();
    const onSelect = jest.fn();
    render(<XyChart chartType="bar" result={timeResult} bucketMs={H} onBrush={onBrush} onSelect={onSelect} />);
    const bar = screen.getAllByRole('button', { name: /info: 85$/ })[0];
    fireEvent.mouseDown(bar, { button: 0, clientX: 100, clientY: 250 });
    fireEvent.mouseMove(window, { clientX: 400, clientY: 250 });
    fireEvent.mouseUp(window, { clientX: 400, clientY: 250 });
    fireEvent.click(bar, { clientX: 400, clientY: 250 });
    expect(onBrush).toHaveBeenCalledTimes(1);
    const [from, to] = onBrush.mock.calls[0];
    expect(from).toBeLessThan(to);
    // Whole seconds (the datasource time macros work in seconds).
    expect(from % 1000).toBe(0);
    expect(to % 1000).toBe(0);
  });

  it('brushSeconds rounds outward to whole seconds, at least one second wide', () => {
    expect(brushSeconds(1_500, 4_200)).toEqual([1_000, 5_000]);
    expect(brushSeconds(4_200, 1_500)).toEqual([1_000, 5_000]);
    expect(brushSeconds(2_000, 2_000)).toEqual([2_000, 3_000]);
    expect(brushSeconds(2_100, 2_300)).toEqual([2_000, 3_000]);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('a press without movement on a bar is still a click', () => {
    const onBrush = jest.fn();
    const onSelect = jest.fn();
    render(<XyChart chartType="bar" result={timeResult} bucketMs={H} onBrush={onBrush} onSelect={onSelect} />);
    const bar = screen.getAllByRole('button', { name: /info: 85$/ })[0];
    fireEvent.mouseDown(bar, { button: 0, clientX: 100, clientY: 250 });
    fireEvent.mouseUp(window, { clientX: 101, clientY: 250 });
    fireEvent.click(bar, { clientX: 101, clientY: 250 });
    expect(onBrush).not.toHaveBeenCalled();
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ xIndex: 0, seriesIndex: 0 }));
  });
});

describe('stable series colours and legend order (item 4)', () => {
  it('assigns colour slots by value, deterministically; a value alone keeps its slot', () => {
    const slots = assignColorSlots(['payments', 'auth', 'checkout', 'frontend', 'inventory'], 50);
    expect(new Set(slots).size).toBe(5);
    expect(slots.every((s) => s < 10)).toBe(true);
    expect(assignColorSlots(['payments'], 50)).toEqual([slots[0]]);
    expect(assignColorSlots(['payments'], 50)).toEqual([hashString('payments') % 10]);
    // More values than base colours: the rest of the palette, all distinct.
    const many = assignColorSlots(
      Array.from({ length: 14 }, (_v, i) => `v${i}`),
      50
    );
    expect(new Set(many).size).toBe(14);
    expect(seriesColorKey({ name: 'Other', breakdown: 'Other', synthetic: true })).not.toBe(
      seriesColorKey({ name: 'Other', breakdown: 'Other' })
    );
  });

  it('a series keeps its colour when the other series go away (click-filter) or the chart type changes', () => {
    const fillOf = () =>
      screen.getAllByRole('button', { name: /payments:/ })[0].getAttribute('fill') ??
      screen.getAllByRole('button', { name: /payments:/ })[0].getAttribute('style');
    const { rerender } = render(<XyChart chartType="bar" result={cats} />);
    const before = fillOf();
    rerender(<XyChart chartType="bar" result={{ ...cats, series: [cats.series[0]] }} />);
    expect(fillOf()).toBe(before);
    rerender(<XyChart chartType="bar" result={{ ...cats, series: [cats.series[1], cats.series[0]] }} />);
    expect(fillOf()).toBe(before);
  });

  it('orders a top values breakdown by total count descending, Other last; alphabetical / ascending ranks too', () => {
    const state: LensState = {
      chartType: 'bar',
      buckets: [
        { kind: 'date_histogram', id: 'x', field: 'Timestamp', label: 'Timestamp', interval: 'auto' },
        { kind: 'terms', id: 'b', field: 'ServiceName', label: 'Top 9 values of ServiceName', size: 9, other: true },
      ],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
    };
    const r = shapeLensRows(state, [
      { b0: 0, b1: '', k1: 1, m0: 999 },
      { b0: 0, b1: 'auth', k1: 0, m0: 5 },
      { b0: 0, b1: 'payments', k1: 0, m0: 50 },
      { b0: 0, b1: 'checkout', k1: 0, m0: 7 },
    ]);
    expect(r.series.map((s) => s.name)).toEqual(['payments', 'checkout', 'auth', 'Other']);
    const s2 = { ...state, buckets: [state.buckets[0], { ...state.buckets[1], rankBy: 'alpha' } as any] };
    expect(orderSeries(s2, r.series).map((s) => s.name)).toEqual(['auth', 'checkout', 'payments', 'Other']);
    const s3 = { ...state, buckets: [state.buckets[0], { ...state.buckets[1], rankDir: 'asc' } as any] };
    expect(orderSeries(s3, r.series).map((s) => s.name)).toEqual(['auth', 'checkout', 'payments', 'Other']);
  });
});

describe('value axis (item 5) and number formatting (item 8)', () => {
  it('a 140 peak gives 0–140 by 20, no fractional ticks on counts', () => {
    const peak: LensResult = {
      ...cats,
      series: [
        series(
          'x',
          [
            ['a', 140],
            ['b', 3],
          ],
          undefined
        ),
      ],
    };
    const { rerender } = render(<XyChart chartType="bar" result={peak} />);
    const ticks = () => screen.getAllByTestId('lens-value-tick').map((t) => t.textContent);
    expect(ticks()).toEqual(['0', '20', '40', '60', '80', '100', '120', '140']);
    rerender(
      <XyChart
        chartType="bar"
        result={{
          ...cats,
          series: [
            series(
              'x',
              [
                ['a', 5],
                ['b', 3],
              ],
              undefined
            ),
          ],
        }}
      />
    );
    expect(ticks()).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('thousands separators everywhere, abbreviation only from a million on the axis', () => {
    expect(formatNumber(9264)).toBe('9,264');
    expect(formatNumber(1234567.891)).toBe('1,234,567.891');
    expect(formatAxisNumber(25_000)).toBe('25,000');
    expect(formatAxisNumber(1_500_000)).toBe('1.5M');
    expect(formatAxisNumber(-2_000_000_000)).toBe('-2B');
  });
});

describe('time axis (item 6)', () => {
  it('ticks on round hours with the date under the first tick and at each new day', () => {
    const start = new Date(2026, 0, 5, 6, 0).getTime();
    const ticks = timeTicks(start, start + 9 * H, 10);
    expect(ticks.map((t) => t.label)).toEqual([
      '06:00',
      '07:00',
      '08:00',
      '09:00',
      '10:00',
      '11:00',
      '12:00',
      '13:00',
      '14:00',
      '15:00',
    ]);
    expect(ticks[0].sub).toBe('January 5, 2026');
    expect(ticks.slice(1).every((t) => t.sub === undefined)).toBe(true);
    const night = timeTicks(new Date(2026, 0, 5, 18, 0).getTime(), new Date(2026, 0, 6, 6, 0).getTime(), 5);
    expect(night.map((t) => t.label)).toEqual(['18:00', '21:00', '00:00', '03:00', '06:00']);
    expect(night[2].sub).toBe('January 6, 2026');
    expect(timeStep(0, 7 * 24 * H, 8).unit).toBe('day');
    const days = timeTicks(new Date(2026, 0, 1).getTime(), new Date(2026, 0, 8).getTime(), 10);
    expect(days[0]).toEqual(expect.objectContaining({ label: 'Jan 1', sub: '2026' }));
    expect(days[1].sub).toBeUndefined();
  });

  it('the chart draws round-time ticks, no automatic axis title for time, partial buckets shaded', () => {
    const state: LensState = {
      chartType: 'bar',
      buckets: [{ kind: 'date_histogram', id: 'x', field: 'Timestamp', label: 'Timestamp', interval: 'auto' }],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
    };
    expect(autoAxisTitles(state).bottom).toBe('');
    expect(
      autoAxisTitles({ ...state, buckets: [{ ...state.buckets[0], kind: 'terms', size: 9 } as any] }).bottom
    ).not.toBe('');
    render(
      <XyChart
        chartType="bar"
        result={timeResult}
        bucketMs={H}
        timeRange={{ from: t0 + 30 * 60_000, to: t0 + 3 * H + 30 * 60_000 }}
        axisTitles={autoAxisTitles(state)}
      />
    );
    const labels = screen.getAllByTestId('lens-category-tick').map((t) => t.textContent);
    expect(labels[0]).toBe('06:00');
    expect(screen.getAllByTestId('lens-category-subtick')[0]).toHaveTextContent('January 5, 2026');
    expect(screen.queryByTestId('lens-axis-title-bottom')).toBeNull();
    expect(screen.getAllByTestId('lens-partial-bucket')).toHaveLength(2);
  });
});

describe('plain lines (item 7)', () => {
  it('points are hidden except an isolated one and the hovered X', () => {
    const gappy: LensResult = {
      ...timeResult,
      series: [
        {
          ...series(
            'v',
            [
              [t0, 1],
              [t0 + H, 2],
              [t0 + 3 * H, 4],
            ],
            undefined
          ),
          zeroFill: false,
        },
      ],
    };
    render(<XyChart chartType="line" result={gappy} bucketMs={H} />);
    const vis = () => screen.getAllByRole('button', { name: /· v:/ }).map((c) => c.getAttribute('data-point-visible'));
    expect(vis()).toEqual(['false', 'false', 'true']);
    fireEvent.mouseMove(svgOf(), { clientX: 60, clientY: 100 });
    expect(vis()).toEqual(['true', 'false', 'true']);
    expect(screen.getByTestId('lens-crosshair')).toBeInTheDocument();
  });
});

describe('legend colour picker (item 10)', () => {
  it('the legend ⋮ menu sets and resets a series colour', () => {
    const onSeriesColor = jest.fn();
    const { rerender } = render(<XyChart chartType="bar" result={cats} onSeriesColor={onSeriesColor} />);
    fireEvent.click(screen.getByRole('button', { name: 'Legend actions for auth' }));
    const menu = screen.getByRole('menu', { name: 'Actions for auth' });
    expect(within(menu).queryByRole('menuitem', { name: 'Filter for' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitemradio', { name: 'Color red' }));
    expect(onSeriesColor).toHaveBeenCalledWith('auth', expect.stringMatching(/^#[0-9a-f]{6}$/));
    rerender(
      <XyChart chartType="bar" result={cats} onSeriesColor={onSeriesColor} style={{ colors: { auth: '#123456' } }} />
    );
    expect(screen.getAllByRole('button', { name: /auth:/ })[0]).toHaveAttribute('fill', '#123456');
    fireEvent.click(screen.getByRole('button', { name: 'Legend actions for auth' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reset color' }));
    expect(onSeriesColor).toHaveBeenLastCalledWith('auth', undefined);
  });

  it('stored colours are cleaned (URL is untrusted), capped, and never reach the query shape', () => {
    expect(cleanStyle({ colors: { a: '#AABBCC', b: 'red', c: '#12345', ['x'.repeat(201)]: '#000000', d: 5 } })).toEqual(
      { colors: { a: '#aabbcc' } }
    );
    expect(cleanStyle({ colors: ['#000000'] })).toBeUndefined();
    const many = Object.fromEntries(Array.from({ length: 80 }, (_v, i) => [`s${i}`, '#000000']));
    expect(Object.keys(cleanStyle({ colors: many })!.colors!)).toHaveLength(MAX_SERIES_COLORS);
    const proto = cleanStyle(JSON.parse('{"colors":{"__proto__":"#ff0000"}}'));
    expect(seriesColorOf(proto, '__proto__')).toBe('#ff0000');
    expect(({} as any).polluted).toBeUndefined();
    expect(seriesColorOf(undefined, 'a')).toBeUndefined();
    expect(seriesColorOf({ colors: { a: '#000000' } }, 'toString')).toBeUndefined();
    let st = withSeriesColor(undefined, 'a', '#00ff00');
    expect(st).toEqual({ colors: { a: '#00ff00' } });
    st = withSeriesColor(st, 'a', undefined);
    expect(st).toBeUndefined();
    const s: LensState = {
      chartType: 'bar',
      style: { colors: { a: '#00ff00' } },
      buckets: [{ kind: 'terms', id: 'b', field: 'ServiceName', label: 'x', size: 9 }],
      metrics: [{ kind: 'metric', id: 'm', op: 'count' }],
    };
    expect(queryShape(s).style).toBeUndefined();
    expect(decodeLens(encodeLens(s))!.style).toEqual({ colors: { a: '#00ff00' } });
    expect(decodeLens(JSON.stringify({ ...s, style: { colors: { a: 'javascript:1' } } }))!.style).toBeUndefined();
  });

  it('theme colours convert to #rrggbb', () => {
    expect(toHex('#ABC')).toBe('#aabbcc');
    expect(toHex('rgb(255, 0, 16)')).toBe('#ff0010');
    expect(toHex('#11223344')).toBe('#112233');
    expect(toHex('nonsense')).toBe('#000000');
  });
});
