import React from 'react';
import { render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { LogsHistogramPanel } from '../LogsHistogramPanel';
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
