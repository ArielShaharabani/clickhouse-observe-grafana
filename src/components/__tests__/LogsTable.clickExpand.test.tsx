import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { LogsTable } from '../LogsTable';
import { LogRow, SelectedColumn } from '../../types';

const col = (id: string, type: SelectedColumn['type'] = 'string'): SelectedColumn =>
  ({ id, key: id, sqlExpr: id, displayName: id, type, isCore: false }) as SelectedColumn;
const columns = [col('ServiceName'), col('SeverityText'), col('Body', 'text')];
const rows: LogRow[] = [
  { ServiceName: 'payments', SeverityText: '', Body: 'a long body' },
  { ServiceName: 'auth', SeverityText: 'info', Body: 'login ok' },
];

function setup() {
  const onAddFilter = jest.fn();
  render(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} onAddFilter={onAddFilter} />);
  const cell = (ri: number, ci: number) => document.querySelector(`[data-cell="${ri}:${ci}"]`) as HTMLElement;
  // A real click is mousedown + mouseup + click.
  const click = (el: Element) => {
    fireEvent.mouseDown(el);
    fireEvent.mouseUp(el);
    fireEvent.click(el);
  };
  return { cell, click, onAddFilter };
}

afterEach(() => jest.restoreAllMocks());

it('a left click on a cell opens the Expand popover; a click on the same cell closes it', () => {
  const { cell, click } = setup();
  click(cell(0, 0));
  expect(screen.getByRole('dialog', { name: /Value of ServiceName/ })).toBeInTheDocument();
  click(cell(0, 0));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('a click on another cell moves the popover there', () => {
  const { cell, click } = setup();
  click(cell(0, 0));
  click(cell(1, 1));
  expect(screen.queryByRole('dialog', { name: /Value of ServiceName/ })).toBeNull();
  expect(screen.getByRole('dialog', { name: /Value of SeverityText/ })).toBeInTheDocument();
});

it('an empty cell does not expand', () => {
  const { cell, click } = setup();
  click(cell(0, 1));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('the cell action buttons do not expand', () => {
  const { cell, click, onAddFilter } = setup();
  fireEvent.mouseEnter(cell(1, 0));
  // The hovered cell shows its toolbar.
  const filter = screen.getByRole('button', { name: 'Filter for ServiceName: auth' });
  click(filter);
  expect(onAddFilter).toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('selecting text does not expand', () => {
  const { cell } = setup();
  jest.spyOn(window, 'getSelection').mockReturnValue({ toString: () => 'pay' } as unknown as Selection);
  fireEvent.mouseDown(cell(0, 0));
  fireEvent.click(cell(0, 0));
  expect(screen.queryByRole('dialog')).toBeNull();
});

describe('Click to expand hint', () => {
  const mockOverflow = (overflow: boolean) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => (overflow ? 200 : 50) });
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 50 });
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => 20 });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 20 });
  };
  afterEach(() => {
    for (const p of ['scrollWidth', 'clientWidth', 'scrollHeight', 'clientHeight']) {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>)[p];
    }
  });

  it('shows on hover of a cut-off cell and leaves on mouse leave', () => {
    mockOverflow(true);
    const { cell } = setup();
    expect(screen.queryByTestId('cell-expand-hint')).toBeNull();
    fireEvent.mouseEnter(cell(0, 0));
    expect(screen.getByTestId('cell-expand-hint')).toHaveTextContent('Click to expand');
    fireEvent.mouseLeave(cell(0, 0));
    expect(screen.queryByTestId('cell-expand-hint')).toBeNull();
  });

  it('does not show on a cell that fits', () => {
    mockOverflow(false);
    const { cell } = setup();
    fireEvent.mouseEnter(cell(0, 0));
    expect(screen.queryByTestId('cell-expand-hint')).toBeNull();
  });

  it('is replaced by the popover once expanded', () => {
    mockOverflow(true);
    const { cell, click } = setup();
    fireEvent.mouseEnter(cell(0, 0));
    click(cell(0, 0));
    expect(screen.queryByTestId('cell-expand-hint')).toBeNull();
  });
});
