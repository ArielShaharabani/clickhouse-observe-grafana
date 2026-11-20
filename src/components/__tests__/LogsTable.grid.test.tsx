/**
 * DISC-TABLE-01 / DISC-TABLE-02: results grid keyboard model, Expand popover and display options.
 */
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LogsTable } from '../LogsTable';
import { expandedText } from '../CellExpandPopover';
import { DEFAULT_GRID_DISPLAY, loadGridDisplay, saveGridDisplay } from '../GridDisplayOptions';
import { LogRow, SelectedColumn } from '../../types';

const col = (id: string, type: SelectedColumn['type'] = 'string'): SelectedColumn =>
  ({ id, key: id, sqlExpr: id, displayName: id, type, isCore: false }) as SelectedColumn;
const columns = [col('ServiceName'), col('SeverityText'), col('Body', 'text')];
const rows: LogRow[] = [
  { ServiceName: 'payments', SeverityText: 'error', Body: '{"a":1,"b":[2]}' },
  { ServiceName: 'auth', SeverityText: 'info', Body: 'login ok' },
];

function setup(extra: Partial<React.ComponentProps<typeof LogsTable>> = {}) {
  const onAddFilter = jest.fn();
  const onPageStep = jest.fn(() => true);
  const onRowClick = jest.fn();
  render(
    <LogsTable rows={rows} loading={false} columns={columns} onRowClick={onRowClick} onAddFilter={onAddFilter} onPageStep={onPageStep} {...extra} />
  );
  const grid = screen.getByRole('grid', { name: 'Log results' });
  grid.focus();
  const key = (k: string, opts: object = {}) => fireEvent.keyDown(grid, { key: k, ...opts });
  const focused = () => grid.querySelector('[aria-selected="true"][data-cell]')?.getAttribute('data-cell');
  return { grid, key, focused, onAddFilter, onPageStep, onRowClick };
}

describe('DISC-TABLE-01 keyboard navigation', () => {
  it('moves a cell focus with arrows, Home/End and Ctrl+Home/End', () => {
    const { key, focused } = setup();
    key('ArrowDown');
    expect(focused()).toBe('0:0');
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowRight'); // clamps at the last column
    expect(focused()).toBe('0:2');
    key('ArrowDown');
    expect(focused()).toBe('1:2');
    key('Home');
    expect(focused()).toBe('1:0');
    key('End');
    expect(focused()).toBe('1:2');
    key('Home', { ctrlKey: true });
    expect(focused()).toBe('0:0');
    key('End', { ctrlKey: true });
    expect(focused()).toBe('1:2');
  });

  it('PgUp / PgDn change page', () => {
    const { key, onPageStep } = setup();
    key('PageDown');
    key('PageUp');
    expect(onPageStep.mock.calls).toEqual([[1], [-1]]);
  });

  it('shows the cell action bar on the focused cell', () => {
    const { key } = setup();
    key('ArrowDown');
    expect(screen.getByRole('button', { name: 'Filter for ServiceName: payments' })).toBeTruthy();
  });
});

describe('DISC-TABLE-02 Expand popover', () => {
  it('Enter opens the full value with Filter for / Filter out / Copy value; Escape closes', () => {
    const { key, onAddFilter } = setup();
    key('ArrowDown');
    key('End');
    key('Enter');
    const dialog = screen.getByRole('dialog', { name: 'Value of Body' });
    expect(within(dialog).getByTestId('cell-expand-value').textContent).toBe('{\n  "a": 1,\n  "b": [\n    2\n  ]\n}');
    fireEvent.click(within(dialog).getByRole('button', { name: /^Filter out Body/ }));
    expect(onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ field: 'Body', op: '!=', value: '{"a":1,"b":[2]}' }));
    expect(within(dialog).getByRole('button', { name: 'Copy value of Body' })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens from the cell action bar too', () => {
    setup();
    fireEvent.mouseEnter(screen.getByText('auth').closest('td')!);
    fireEvent.click(screen.getByRole('button', { name: 'Expand value of ServiceName' }));
    expect(screen.getByRole('dialog', { name: 'Value of ServiceName' })).toBeTruthy();
  });

  it('pretty-prints objects and JSON text, leaves other text alone', () => {
    expect(expandedText({ a: 1 })).toBe('{\n  "a": 1\n}');
    expect(expandedText('[1,2]')).toBe('[\n  1,\n  2\n]');
    expect(expandedText('{not json')).toBe('{not json');
    expect(expandedText(null)).toBe('');
  });
});

describe('DISC-TABLE-01 display options', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to Normal density and 1 body line (one compact line per row), and remembers the choice', () => {
    expect(loadGridDisplay()).toEqual(DEFAULT_GRID_DISPLAY);
    expect(DEFAULT_GRID_DISPLAY).toEqual({ density: 'normal', bodyLines: 1 });
    saveGridDisplay({ density: 'compact', bodyLines: 'auto' });
    expect(loadGridDisplay()).toEqual({ density: 'compact', bodyLines: 'auto' });
    localStorage.setItem('clickhouse-observe.gridDisplay', '{"density":"huge"}');
    expect(loadGridDisplay()).toEqual(DEFAULT_GRID_DISPLAY);
  });

  it('clamps the body cell to the chosen number of lines', () => {
    setup({ display: { density: 'compact', bodyLines: 5 } });
    const body = screen.getByText('login ok');
    expect(body.style.minHeight).toBe('7.5em'); // 5 lines × 1.5 (jsdom drops -webkit-line-clamp)
  });
});

describe('DISC-TABLE-01/02 review fixes', () => {
  it('Shift+Enter opens the row detail; Enter expands the cell', () => {
    const { key, onRowClick } = setup();
    key('ArrowDown');
    key('ArrowDown');
    key('Enter', { shiftKey: true });
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('PgDn on the last page keeps the cursor and native scrolling', () => {
    const { key, focused, onPageStep } = setup();
    onPageStep.mockReturnValue(false);
    key('ArrowDown');
    key('ArrowDown');
    const ev = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    screen.getByRole('grid').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(focused()).toBe('1:0');
  });

  it('a mouse click focuses the clicked cell, and the action bar follows hover only', () => {
    const { key, focused } = setup();
    fireEvent.mouseDown(screen.getByText('info').closest('td')!);
    expect(focused()).toBe('1:1');
    expect(screen.queryByRole('button', { name: /^Filter for / })).toBeNull();
    key('Enter');
    expect(screen.getByRole('dialog', { name: 'Value of SeverityText' })).toBeTruthy();
  });

  it('the popover closes on an outside click and stays closed after a re-render with new rows', () => {
    const view = render(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} />);
    const grid = view.getAllByRole('grid')[0];
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(view.getByRole('dialog')).toBeTruthy();
    view.rerender(<LogsTable rows={[...rows]} loading={false} columns={columns} onRowClick={jest.fn()} />);
    expect(view.queryByRole('dialog')).toBeNull();
    view.rerender(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} />);
    fireEvent.keyDown(grid, { key: 'Enter' });
    fireEvent.mouseDown(document.body);
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('pretty-prints JSON text without rounding big integers', () => {
    const expected = ['{', '  "trace": 12345678901234567890,', '  "s": "a,b:{c}",', '  "e": [],', '  "o": {}', '}'].join(String.fromCharCode(10));
    expect(expandedText('{"trace":12345678901234567890,"s":"a,b:{c}","e":[],"o":{}}')).toBe(expected);
  });
});
