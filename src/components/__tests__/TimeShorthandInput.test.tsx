import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { TimeShorthandInput } from '../TimeShorthandInput';

const range = {
  from: dateTime(Date.UTC(2026, 0, 1)),
  to: dateTime(Date.UTC(2026, 0, 8)),
  raw: { from: dateTime(Date.UTC(2026, 0, 1)), to: dateTime(Date.UTC(2026, 0, 8)) },
};

describe('TimeShorthandInput (DISC-TIME-01/02)', () => {
  it('shows the duration badge', () => {
    render(<TimeShorthandInput range={range} onApply={jest.fn()} />);
    expect(screen.getByTestId('time-duration-badge')).toHaveTextContent('~7d');
  });

  it('is clean until text is typed, then offers Update; Enter applies and clears', () => {
    const onApply = jest.fn();
    render(<TimeShorthandInput range={range} onApply={onApply} />);
    expect(screen.queryByRole('button', { name: 'Update time range' })).toBeNull();
    const input = screen.getByLabelText('Time range shorthand');
    fireEvent.change(input, { target: { value: '-3h' } });
    expect(screen.getByRole('button', { name: 'Update time range' })).toBeInTheDocument();
    expect(onApply).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].raw).toEqual({ from: 'now-3h', to: 'now' });
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Update time range' })).toBeNull();
  });

  it('Update button applies; invalid text is flagged and not applied; Escape clears', () => {
    const onApply = jest.fn();
    render(<TimeShorthandInput range={range} onApply={onApply} />);
    const input = screen.getByLabelText('Time range shorthand');
    fireEvent.change(input, { target: { value: 'nope' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onApply).not.toHaveBeenCalled();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input).toHaveValue('');
    fireEvent.change(input, { target: { value: 'yd' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update time range' }));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
