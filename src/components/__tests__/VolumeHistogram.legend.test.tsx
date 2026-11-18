import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { VolumeHistogram } from '../VolumeHistogram';
import { triggerLabel } from '../HistogramControls/BreakdownPicker';
import { VolumeDataPoint } from '../../types';
import { FieldModel } from '../../sql/fieldModel';

// DISC-CHART-02 (docs/spec/10-discover.md): breakdown label, legend isolate / hide with an
// eye-slash icon and y-axis rescale, ⋮ legend menu titled with the value → Filter for / out.

const T0 = Date.UTC(2026, 0, 5);
const H = 3_600_000;
const data: VolumeDataPoint[] = [
  { time: T0, levels: { payments: 900, auth: 40, other: 60 } },
  { time: T0 + H, levels: { payments: 800, auth: 30, other: 50 } },
];
const timeRange = { from: dateTime(T0), to: dateTime(T0 + 2 * H), raw: { from: '', to: '' } };

function renderChart(extra: Partial<React.ComponentProps<typeof VolumeHistogram>> = {}) {
  const onAddFilter = jest.fn();
  const utils = render(
    <VolumeHistogram
      data={data}
      timeRange={timeRange}
      colorMode="breakdown"
      bucketMs={H}
      breakdownTarget={{ field: 'ServiceName' }}
      onAddFilter={onAddFilter}
      {...extra}
    />
  );
  return { ...utils, onAddFilter };
}

const legend = () => screen.getByRole('list', { name: 'Histogram legend' });
const legendButton = (name: string) => within(legend()).getByRole('button', { name: new RegExp(`^(hidden )?${name}$`) });

describe('DISC-CHART-02 breakdown trigger label', () => {
  it('reads "No breakdown" until a field is chosen, then "Breakdown by <field>"', () => {
    expect(triggerLabel({ kind: 'none' })).toBe('No breakdown');
    expect(triggerLabel({ kind: 'severity' })).toBe('Breakdown by Severity');
    const field = { displayName: 'ServiceName' } as FieldModel;
    expect(triggerLabel({ kind: 'field', field })).toBe('Breakdown by ServiceName');
  });
});

describe('DISC-CHART-02 legend', () => {
  it('lists the series by total with the synthetic "other" last', () => {
    renderChart();
    const items = within(legend()).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual(['payments', 'auth', 'other']);
  });

  it('click isolates a series: the others show an eye-slash and the y-axis rescales', () => {
    renderChart();
    const yLabels = () => [screen.getByTestId('histogram-y-axis').textContent ?? ''];
    expect(yLabels().join(' ')).toMatch(/1K|1000|1 K/);
    fireEvent.click(legendButton('auth'));
    expect(legendButton('auth')).toHaveAttribute('aria-pressed', 'true');
    expect(legendButton('payments')).toHaveAttribute('aria-pressed', 'false');
    expect(within(legend()).getAllByTestId('legend-hidden-icon')).toHaveLength(2);
    // Only auth (max 40) is left: the axis tops out well below 100.
    expect(yLabels().join(' ')).not.toMatch(/1K|1000|1 K/);
    // Clicking the isolated series again shows everything.
    fireEvent.click(legendButton('auth'));
    expect(within(legend()).queryAllByTestId('legend-hidden-icon')).toHaveLength(0);
  });

  it('ctrl+click hides just that series (and shows it again)', () => {
    renderChart();
    fireEvent.click(legendButton('payments'), { ctrlKey: true });
    expect(legendButton('payments')).toHaveAttribute('aria-pressed', 'false');
    expect(legendButton('auth')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(legendButton('payments'), { metaKey: true });
    expect(legendButton('payments')).toHaveAttribute('aria-pressed', 'true');
  });

  it('⋮ opens a popover titled with the value: Filter for / Filter out add a pill', () => {
    const { onAddFilter } = renderChart();
    fireEvent.click(screen.getByRole('button', { name: 'Legend actions for payments' }));
    const dialog = screen.getByRole('dialog', { name: 'Actions for payments' });
    expect(dialog).toHaveTextContent('payments');
    fireEvent.click(within(dialog).getByRole('button', { name: /Filter out/ }));
    expect(onAddFilter).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'ServiceName', value: 'payments', op: '!=' })
    );
    expect(screen.queryByRole('dialog', { name: 'Actions for payments' })).toBeNull();
  });

  it('opening the menu moves focus to its first action (keyboard users)', async () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: 'Legend actions for auth' }));
    const dialog = screen.getByRole('dialog', { name: 'Actions for auth' });
    await waitFor(() => expect(within(dialog).getAllByRole('button')[0]).toHaveFocus());
  });

  it('Escape closes the legend popover', () => {
    renderChart();
    fireEvent.click(screen.getByRole('button', { name: 'Legend actions for auth' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Actions for auth' })).toBeNull();
  });

  it('the synthetic "other" series has no filter menu, and shift-click does not filter it', () => {
    const { onAddFilter } = renderChart();
    expect(screen.queryByRole('button', { name: 'Legend actions for other' })).toBeNull();
    fireEvent.click(legendButton('other'), { shiftKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onAddFilter).not.toHaveBeenCalled();
  });

  it('no ⋮ when the chart cannot filter (no target field)', () => {
    renderChart({ breakdownTarget: undefined });
    expect(screen.queryByRole('button', { name: /Legend actions/ })).toBeNull();
  });

  it('a new breakdown clears hidden series from the previous one', () => {
    const { rerender, onAddFilter } = renderChart();
    fireEvent.click(legendButton('auth'));
    expect(within(legend()).getAllByTestId('legend-hidden-icon')).toHaveLength(2);
    rerender(
      <VolumeHistogram
        data={data}
        timeRange={timeRange}
        colorMode="breakdown"
        bucketMs={H}
        breakdownTarget={{ field: 'host' }}
        onAddFilter={onAddFilter}
      />
    );
    expect(within(legend()).queryAllByTestId('legend-hidden-icon')).toHaveLength(0);
  });
});
