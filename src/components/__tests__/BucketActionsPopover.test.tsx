import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { BucketActionsPopover, bucketEnd, seriesFilter } from '../BucketActionsPopover';
import { formatRangeCaption } from '../LogsHistogramPanel';
import { dateTime } from '@grafana/data';

const T0 = Date.UTC(2026, 0, 5, 9);
const series = [
  { name: 'error', count: 600, color: 'red' },
  { name: 'info', count: 300, color: 'green' },
];

describe('DISC-CHART-01 right-click bucket actions', () => {
  it('Filter by time zooms to the bucket', () => {
    const onSelectRange = jest.fn();
    const onClose = jest.fn();
    render(<BucketActionsPopover time={T0} bucketMs={3_600_000} series={[]} clientX={10} clientY={10} onSelectRange={onSelectRange} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter by time' }));
    expect(onSelectRange).toHaveBeenCalledWith(T0, T0 + 3_600_000);
    expect(onClose).toHaveBeenCalled();
  });

  it('filters the ticked series: one value as =, several as one of', () => {
    const onAddFilter = jest.fn();
    render(
      <BucketActionsPopover time={T0} bucketMs={1} series={series} clientX={0} clientY={0} field="SeverityText" onAddFilter={onAddFilter} onClose={jest.fn()} />
    );
    const go = () => screen.getByRole('button', { name: /^Filter \d selected series$/ });
    expect(go()).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select series error' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select series info' }));
    expect(go().textContent).toContain('Filter 2 selected series');
    fireEvent.click(go());
    expect(onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ field: 'SeverityText', op: 'one_of', values: ['error', 'info'] }));
    expect(seriesFilter('f', ['a'])).toMatchObject({ field: 'f', op: '=', value: 'a' });
  });

  it('Escape closes it', () => {
    const onClose = jest.fn();
    render(<BucketActionsPopover time={T0} bucketMs={1} series={[]} clientX={0} clientY={0} onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Bucket actions' }), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('caption shows the absolute range', () => {
    const from = dateTime(Date.UTC(2026, 0, 1));
    const to = dateTime(Date.UTC(2026, 0, 8));
    expect(formatRangeCaption({ from, to, raw: { from, to } })).toMatch(/^\w{3} \d{1,2}, 2026 @ \d\d:\d\d:\d\d\.000 - \w{3} \d{1,2}, 2026 @ \d\d:\d\d:\d\d\.000$/);
  });

  it('month and year buckets end at the next calendar boundary', () => {
    const jan = Date.UTC(2026, 0, 1);
    expect(bucketEnd(jan, 30 * 86_400_000)).toBe(Date.UTC(2026, 1, 1));
    expect(bucketEnd(Date.UTC(2026, 1, 1), 30 * 86_400_000)).toBe(Date.UTC(2026, 2, 1));
    expect(bucketEnd(Date.UTC(2028, 0, 1), 365 * 86_400_000)).toBe(Date.UTC(2029, 0, 1));
    expect(bucketEnd(jan, 3_600_000)).toBe(jan + 3_600_000);
  });

  it('counts only ticked series still in the bucket', () => {
    const onAddFilter = jest.fn();
    const props = { time: T0, bucketMs: 1, clientX: 0, clientY: 0, field: 'SeverityText', onAddFilter, onClose: jest.fn() };
    const view = render(<BucketActionsPopover {...props} series={series} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select series error' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select series info' }));
    view.rerender(<BucketActionsPopover {...props} series={[series[1]]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Filter 1 selected series' }));
    expect(onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ op: '=', value: 'info' }));
  });
});
