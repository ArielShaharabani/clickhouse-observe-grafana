import React from 'react';
import { render, screen } from '@testing-library/react';
import { PieChart, pieLayout } from '../render/PieChart';

describe('R8 draw: M5 pie with negative values', () => {
  it('says so and shows no percentages', () => {
    render(<PieChart names={['a', 'b', 'c']} values={[-186, 154, 100]} colors={['#111', '#222', '#333']} donut={false} />);
    expect(screen.getByTestId('lens-pie-negative').textContent).toMatch(/Negative values/);
    expect(screen.getByTestId('lens-pie-legend').textContent).not.toMatch(/%/);
  });
  it('no note when all values are positive', () => {
    render(<PieChart names={['a', 'b']} values={[1, 3]} colors={['#111', '#222']} donut={false} />);
    expect(screen.queryByTestId('lens-pie-negative')).toBeNull();
    expect(screen.getByTestId('lens-pie-legend').textContent).toMatch(/75%/);
  });
  it('labels carry no percent when asked', () => {
    const l = pieLayout([1, 3], ['a', 'b'], 400, 300, false, false);
    expect(l.slices.every((s) => !(s.label?.lines.join(' ') ?? '').includes('%'))).toBe(true);
  });
});
