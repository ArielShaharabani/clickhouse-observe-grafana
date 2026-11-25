import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { clampHistogramHeight, HISTOGRAM_HEIGHT_KEY, LogsHistogramPanel } from '../LogsHistogramPanel';
import { resolveInterval } from '../VolumeHistogram';

// Round 2 #2: an invalid search must not leave the previous search's bars and count on screen.
const timeRange = {
  from: dateTime(Date.UTC(2026, 0, 1)),
  to: dateTime(Date.UTC(2026, 0, 8)),
  raw: { from: dateTime(Date.UTC(2026, 0, 1)), to: dateTime(Date.UTC(2026, 0, 8)) },
};

function panel(invalidQuery: boolean, extra: Record<string, unknown> = {}) {
  return (
    <LogsHistogramPanel
      hasTime
      hasSeverity
      intervalMode="auto"
      onIntervalModeChange={jest.fn()}
      timeRange={timeRange}
      breakdown={{ kind: 'none' }}
      onBreakdownChange={jest.fn()}
      volumeData={[{ time: Date.UTC(2026, 0, 5), levels: { error: 1246 } }]}
      volLoading={false}
      totalEvents={1246}
      resolvedInterval={resolveInterval('auto', timeRange)}
      onSelectRange={jest.fn()}
      onAddFilter={jest.fn()}
      collapsed={false}
      onToggleCollapsed={jest.fn()}
      invalidQuery={invalidQuery}
      {...extra}
    />
  );
}

describe('LogsHistogramPanel with an invalid search', () => {
  it('hides the previous bars and count and says why', () => {
    render(panel(true));
    expect(screen.getByTestId('histogram-invalid-query')).toHaveTextContent('the search has an error');
    expect(screen.queryByText(/rows \(count\)/)).toBeNull();
  });

  it('shows the count for a valid search', () => {
    render(panel(false));
    expect(screen.queryByTestId('histogram-invalid-query')).toBeNull();
    expect(screen.getByText(/1,246 rows \(count\)/)).toBeInTheDocument();
  });
});

describe('LogsHistogramPanel breakdown notice (round 2 #17)', () => {
  it('shows the notice and dismisses it', () => {
    const onDismiss = jest.fn();
    render(panel(false, { breakdownNotice: 'Breakdown "x" was not understood', onDismissBreakdownNotice: onDismiss }));
    expect(screen.getByTestId('breakdown-notice')).toHaveTextContent('"x"');
    screen.getByRole('button', { name: 'Dismiss breakdown notice' }).click();
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('histogram resize handle', () => {
  beforeEach(() => window.localStorage.removeItem(HISTOGRAM_HEIGHT_KEY));

  it('clamps to the minimum and ~60% of the viewport', () => {
    expect(clampHistogramHeight(10, 1000)).toBe(80);
    expect(clampHistogramHeight(9999, 1000)).toBe(600);
    expect(clampHistogramHeight(NaN, 1000)).toBe(104);
    expect(clampHistogramHeight(500, 100)).toBe(80);
  });

  it('is a keyboard-operable separator that persists and resets', () => {
    render(panel(false));
    const handle = screen.getByRole('separator', { name: 'Resize histogram' });
    expect(handle).toHaveAttribute('aria-orientation', 'horizontal');
    expect(handle).toHaveAttribute('aria-valuenow', '104');
    expect(handle).toHaveAttribute('tabindex', '0');
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(handle).toHaveAttribute('aria-valuenow', '112');
    expect(window.localStorage.getItem(HISTOGRAM_HEIGHT_KEY)).toBe('112');
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(handle, { key: 'ArrowUp', shiftKey: true });
    expect(handle).toHaveAttribute('aria-valuenow', '80');
    fireEvent.doubleClick(handle);
    expect(handle).toHaveAttribute('aria-valuenow', '104');
    expect(window.localStorage.getItem(HISTOGRAM_HEIGHT_KEY)).toBeNull();
  });

  it('restores a stored height and is hidden when collapsed', () => {
    window.localStorage.setItem(HISTOGRAM_HEIGHT_KEY, '150');
    const { rerender } = render(panel(false));
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '150');
    rerender(panel(false, { collapsed: true }));
    expect(screen.queryByRole('separator')).toBeNull();
  });
});

describe('LogsHistogramPanel without bars', () => {
  const none = { volumeData: [{ time: Date.UTC(2026, 0, 5), levels: {} }], totalEvents: 0 };

  it('is hidden when nothing matched, also while that empty search refreshes', () => {
    const { container, rerender } = render(panel(false, { ...none, volStatus: 'done' }));
    expect(container).toBeEmptyDOMElement();
    rerender(panel(false, { ...none, volStatus: 'done', volLoading: true }));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows loading before the first answer', () => {
    render(panel(false, { ...none, volStatus: 'pending' }));
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it.each([{ volStatus: 'error' }, { volStatus: 'done', hasRows: true }])('says it failed instead of "no data": %p', (extra) => {
    const onRetry = jest.fn();
    render(panel(false, { ...none, ...extra, onRetry }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.getByText(/could not be loaded/)).toBeInTheDocument();
    expect(onRetry).toHaveBeenCalled();
  });
});
