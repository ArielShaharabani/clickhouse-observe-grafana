import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ChartTypeSwitcher, filterChartTypes } from '../ChartTypeSwitcher';

function setup(value: 'bar' | 'metric' | 'line' = 'bar') {
  const onChange = jest.fn();
  const onSubTypeChange = jest.fn();
  render(<ChartTypeSwitcher value={value} subType="stacked" onChange={onChange} onSubTypeChange={onSubTypeChange} />);
  return { onChange, onSubTypeChange };
}

describe('LENS-TYPE-01 chart type switcher', () => {
  it('search matches names and descriptions', () => {
    expect(filterChartTypes('met')).toEqual(['metric']);
    expect(filterChartTypes('over time')).toEqual(['line']);
    expect(filterChartTypes('')).toHaveLength(6);
  });

  it('one open + one selection switches the type; the current type is ticked', () => {
    const { onChange } = setup('metric');
    fireEvent.click(screen.getByRole('button', { name: 'Chart type: Metric' }));
    expect(screen.getByRole('option', { name: /Metric/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('option', { name: /^Bar/ }));
    expect(onChange).toHaveBeenCalledWith('bar');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('keyboard: type to filter, Enter picks; arrows move; Esc closes without change', () => {
    const { onChange } = setup('bar');
    fireEvent.click(screen.getByRole('button', { name: 'Chart type: Bar' }));
    const search = screen.getByRole('combobox', { name: 'Search visualizations' });
    fireEvent.change(search, { target: { value: 'Metric' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('metric');

    fireEvent.click(screen.getByRole('button', { name: 'Chart type: Bar' }));
    const search2 = screen.getByRole('combobox', { name: 'Search visualizations' });
    fireEvent.keyDown(search2, { key: 'ArrowDown' }); // bar → line
    fireEvent.keyDown(search2, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('line');

    fireEvent.click(screen.getByRole('button', { name: 'Chart type: Bar' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search visualizations' }), { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('XY sub-type: Stacked / Percentage / Unstacked for bar and area only', () => {
    const { onSubTypeChange } = setup('bar');
    fireEvent.click(screen.getByRole('radio', { name: 'Percentage' }));
    expect(onSubTypeChange).toHaveBeenCalledWith('percentage');
  });

  it('no sub-type control for a metric', () => {
    setup('metric');
    expect(screen.queryByRole('radio', { name: 'Percentage' })).toBeNull();
  });
});
