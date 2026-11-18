import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { formatElapsed, QueryProgress } from '../QueryProgress/QueryProgress';
import { lensApproxNote } from '../../lens/approx';

describe('formatElapsed', () => {
  it('formats seconds and minutes', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(4999)).toBe('4s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(-10)).toBe('0s');
  });
});

describe('QueryProgress', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('renders nothing visible while idle', () => {
    render(<QueryProgress active={false} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the bar at once and the slow chip only after the delay', () => {
    render(<QueryProgress active slowAfterMs={2000} />);
    expect(screen.getByRole('progressbar', { name: 'Loading results' })).toBeInTheDocument();
    expect(screen.queryByTestId('query-progress-slow')).toBeNull();
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('query-progress-slow')).toHaveTextContent('Still running · 3s');
    // No onCancel → no Cancel button.
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('Cancel calls onCancel and leaves a dismissible cancelled notice', () => {
    const onCancel = jest.fn();
    const { rerender } = render(<QueryProgress active onCancel={onCancel} slowAfterMs={1000} />);
    act(() => {
      jest.advanceTimersByTime(1000);
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    rerender(<QueryProgress active={false} onCancel={onCancel} slowAfterMs={1000} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('query-progress-cancelled')).toHaveTextContent('Query cancelled');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('query-progress-cancelled')).toBeNull();
  });

  it('a new run clears the cancelled notice and restarts the clock', () => {
    const { rerender } = render(<QueryProgress active onCancel={() => undefined} slowAfterMs={1000} />);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    rerender(<QueryProgress active={false} onCancel={() => undefined} slowAfterMs={1000} />);
    rerender(<QueryProgress active onCancel={() => undefined} slowAfterMs={1000} />);
    expect(screen.queryByTestId('query-progress-cancelled')).toBeNull();
    expect(screen.queryByTestId('query-progress-slow')).toBeNull();
  });

  it('no cancelled notice when a run simply finishes', () => {
    const { rerender } = render(<QueryProgress active onCancel={() => undefined} />);
    rerender(<QueryProgress active={false} onCancel={() => undefined} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('lensApproxNote', () => {
  it('flags unique count only', () => {
    expect(lensApproxNote({ metrics: [{ op: 'count' }] } as any)).toBeNull();
    expect(lensApproxNote({ metrics: [{ op: 'avg', field: 'd' }] } as any)).toBeNull();
    expect(lensApproxNote({ metrics: [{ op: 'count' }, { op: 'unique', field: 'svc' }] } as any)).toMatch(/approximate/);
  });
});
