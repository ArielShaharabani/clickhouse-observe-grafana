import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { stackValues, xLabel } from '../render/XyChart';
import { FilterChooser } from '../FilterChooser';
import { LensResult } from '../compile';
import { makeFilter } from '../../sql/filters';

const result: LensResult = {
  xs: ['a', 'b'],
  xIsTime: false,
  series: [
    {
      name: 'error',
      points: new Map([
        ['a', 1],
        ['b', 3],
      ]),
      breakdown: 'error',
      metricIndex: 0,
    },
    {
      name: 'info',
      points: new Map([
        ['a', 3],
        ['b', 1],
      ]),
      breakdown: 'info',
      metricIndex: 0,
    },
  ],
  table: { columns: [], rows: [] },
};

describe('XyChart geometry', () => {
  it('stacks, normalises to percent, or keeps side by side', () => {
    expect(stackValues(result, [true, true], 'stacked')).toEqual({
      spans: [
        [
          [0, 1],
          [0, 3],
        ],
        [
          [1, 4],
          [3, 4],
        ],
      ],
      max: 4,
    });
    expect(stackValues(result, [true, true], 'percentage').spans[1][0]).toEqual([25, 100]);
    expect(stackValues(result, [true, true], 'none')).toMatchObject({
      max: 3,
      spans: [
        [
          [0, 1],
          [0, 3],
        ],
        [
          [0, 3],
          [0, 1],
        ],
      ],
    });
  });

  it('hidden series drop out of the stack and the scale', () => {
    expect(stackValues(result, [false, true], 'stacked')).toEqual({
      spans: [
        [null, null],
        [
          [0, 3],
          [0, 1],
        ],
      ],
      max: 3,
    });
  });

  it('labels: empty category, time format', () => {
    expect(xLabel('', false, 0)).toBe('(empty)');
    expect(xLabel(Date.UTC(2026, 0, 1, 6), true, 7 * 86_400_000)).toMatch(/^01-01 \d\d:\d\d$/);
  });
});

describe('LENS-INTERACT-01 Select filters to apply', () => {
  const choices = [
    { label: 'ServiceName: payments', pill: makeFilter('ServiceName', 'payments') },
    { label: 'SeverityText: error', pill: makeFilter('SeverityText', 'error') },
  ];

  it('all values are pre-ticked; unticking one applies the rest', () => {
    const onApply = jest.fn();
    render(<FilterChooser choices={choices} onApply={onApply} onCancel={jest.fn()} />);
    expect(screen.getAllByRole('checkbox').every((c) => (c as HTMLInputElement).checked)).toBe(true);
    fireEvent.click(screen.getByLabelText('ServiceName: payments'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith([choices[1]]);
  });

  it('Cancel applies nothing; Apply is disabled with nothing ticked', () => {
    const onApply = jest.fn();
    const onCancel = jest.fn();
    render(<FilterChooser choices={choices.slice(0, 1)} onApply={onApply} onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText('ServiceName: payments'));
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });
});
