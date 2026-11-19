/**
 * SHARED-A11Y-01: popovers announced as dialogs, Escape and focus return, pill menu keyboard,
 * field Preview buttons, grid active descendant and header controls.
 */
import React, { useRef, useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { DIALOG_HINT, moveMenuFocus, usePopoverDialog } from '../dialog';
import { FilterPills } from '../../FilterPills';
import { AddFilterPopover } from '../../AddFilter/AddFilterPopover';
import { FieldItem } from '../../FieldSidebar/FieldItem';
import { LogsTable } from '../../LogsTable';
import { BucketActionsPopover } from '../../BucketActionsPopover';
import { DEFAULT_GRID_DISPLAY, GridDisplayOptions } from '../../GridDisplayOptions';
import { FieldTypeFilter } from '../../FieldSidebar/FieldTypeFilter';
import { makeFilter } from '../../../sql/filters';
import { FieldModel } from '../../../sql/fieldModel';
import { DEFAULT_LOGS_QUERY_STATE, LogRow, SelectedColumn } from '../../../types';

jest.mock('../../FieldSidebar/FieldStatsPopover', () => ({
  FieldStatsPopover: () => <button type="button">Visualize</button>,
}));
jest.mock('../../AddFilter/FilterEditForm', () => ({
  FilterEditForm: () => <input aria-label="Field" />,
}));

function Popover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const { dialogProps, hint } = usePopoverDialog(ref, { onClose });
  return (
    <div ref={ref} {...dialogProps} aria-label="Test popover">
      {hint}
      <button type="button">Inside</button>
    </div>
  );
}

function Host({ onCloseSpy = () => {} }: { onCloseSpy?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <button type="button">Elsewhere</button>
      {open && (
        <Popover
          onClose={() => {
            onCloseSpy();
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

describe('usePopoverDialog', () => {
  it('is a dialog described by the Escape hint, takes focus and gives it back on Escape', async () => {
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Test popover' });
    expect(dialog).toHaveAccessibleDescription(DIALOG_HINT);
    await waitFor(() => expect(dialog).toHaveFocus());
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });

  it('Escape closes it while focus is still on the page', () => {
    const spy = jest.fn();
    render(<Host onCloseSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('ignores an Escape a control inside already used (an open list)', () => {
    const spy = jest.fn();
    render(<Host onCloseSpy={spy} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const inside = screen.getByRole('button', { name: 'Inside' });
    inside.addEventListener('keydown', (e) => e.preventDefault());
    fireEvent.keyDown(inside, { key: 'Escape' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('leaves focus where the user moved it', () => {
    function Toggle() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setOpen(false)}>
            Elsewhere
          </button>
          {open && <Popover onClose={() => setOpen(false)} />}
        </>
      );
    }
    render(<Toggle />);
    const other = screen.getByRole('button', { name: 'Elsewhere' });
    other.focus();
    fireEvent.click(other);
    expect(other).toHaveFocus();
  });

  it('moveMenuFocus wraps with the arrows and jumps with Home / End', () => {
    render(
      <div role="menu" data-testid="m">
        <button role="menuitem">A</button>
        <button role="menuitem">B</button>
        <button role="menuitem">C</button>
      </div>
    );
    const menu = screen.getByTestId('m');
    const [a, b, c] = screen.getAllByRole('menuitem');
    a.focus();
    expect(moveMenuFocus(menu, 'ArrowDown')).toBe(true);
    expect(b).toHaveFocus();
    moveMenuFocus(menu, 'End');
    expect(c).toHaveFocus();
    moveMenuFocus(menu, 'ArrowDown');
    expect(a).toHaveFocus();
    moveMenuFocus(menu, 'ArrowUp');
    expect(c).toHaveFocus();
    moveMenuFocus(menu, 'Home');
    expect(a).toHaveFocus();
    expect(moveMenuFocus(menu, 'x')).toBe(false);
  });
});

describe('filter pill menu and editor', () => {
  const pill = makeFilter('ServiceName', 'payments', '=');
  function renderPills() {
    const onChange = jest.fn();
    render(<FilterPills filters={[pill]} onChange={onChange} loadValues={async () => []} pinTable="db.t" />);
    return { onChange, body: screen.getByRole('button', { name: /^Filter actions: ServiceName/ }) };
  }

  it('menu items are menuitems: focus starts on the first, arrows move, Escape returns to the pill', async () => {
    const { body } = renderPills();
    expect(body).toHaveAttribute('aria-haspopup', 'menu');
    body.focus();
    fireEvent.click(body);
    const menu = screen.getByRole('menu', { name: 'Filter actions' });
    const items = within(menu).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual([
      'Pin across pages',
      'Edit filter',
      'Exclude results',
      'Temporarily disable',
      'Delete',
    ]);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(body).toHaveFocus();
  });

  it('Tab closes the menu and returns to the pill', () => {
    const { body } = renderPills();
    fireEvent.click(body);
    fireEvent.keyDown(screen.getAllByRole('menuitem')[0], { key: 'Tab' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(body).toHaveFocus();
  });

  it('Edit filter opens a dialog; Escape closes it and focus goes back to the pill', () => {
    const { body } = renderPills();
    fireEvent.click(body);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit filter' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit filter' });
    expect(dialog).toHaveAccessibleDescription(DIALOG_HINT);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(body).toHaveFocus();
  });
});

describe('Add filter popover', () => {
  it('is a dialog; Escape closes it and focus returns to the trigger', () => {
    render(<AddFilterPopover loadValues={async () => []} onAddFilter={jest.fn()} />);
    const trigger = screen.getByRole('button', { name: 'Add filter' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Add filter' });
    expect(dialog).toHaveAccessibleDescription(DIALOG_HINT);
    fireEvent.keyDown(within(dialog).getByRole('textbox', { name: 'Field' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});

describe('Discover field list', () => {
  const field: FieldModel = {
    id: 'col:log.level',
    name: 'log.level',
    displayName: 'log.level',
    sqlExpr: 'log.level',
    type: 'string',
    source: 'column',
  };
  const now = dateTime(0);
  function renderItem(isSelected = false) {
    const onToggleColumn = jest.fn();
    render(
      <FieldItem
        field={field}
        isSelected={isSelected}
        queryState={DEFAULT_LOGS_QUERY_STATE}
        timeRange={{ from: now, to: now, raw: { from: now, to: now } }}
        onToggleColumn={onToggleColumn}
        onAddFilter={jest.fn()}
      />
    );
    return { onToggleColumn };
  }

  it('Preview button names the field and type; Enter opens the details dialog, Escape returns focus', () => {
    renderItem();
    const preview = screen.getByRole('button', { name: 'Preview log.level: string' });
    expect(preview).toHaveAttribute('aria-haspopup', 'dialog');
    preview.focus();
    fireEvent.click(preview); // what Enter / Space do on a button
    expect(preview).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'log.level' });
    expect(dialog).toHaveAccessibleDescription(DIALOG_HINT);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(preview).toHaveFocus();
  });

  it('row actions have specific names', () => {
    const { onToggleColumn } = renderItem();
    fireEvent.click(screen.getByRole('button', { name: 'Add log.level as column' }));
    expect(onToggleColumn).toHaveBeenCalledWith(field);
    expect(screen.queryByRole('dialog')).toBeNull(); // the action does not open the popover
  });
});

describe('results grid', () => {
  const col = (id: string): SelectedColumn =>
    ({ id, key: id, sqlExpr: id, displayName: id, type: 'string', isCore: false }) as SelectedColumn;
  const columns = [col('ServiceName'), col('SeverityText')];
  const rows: LogRow[] = [
    { ServiceName: 'payments', SeverityText: 'error' },
    { ServiceName: 'auth', SeverityText: 'info' },
  ];

  it('points aria-activedescendant at the keyboard cell', () => {
    render(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} />);
    const grid = screen.getByRole('grid', { name: 'Log results' });
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'ArrowRight' });
    const id = grid.getAttribute('aria-activedescendant');
    expect(id).toBeTruthy();
    const cell = document.getElementById(id!);
    expect(cell).toHaveAttribute('data-cell', '0:1');
    expect(cell).toHaveTextContent('error');
  });

  it('sorting is a button with aria-sort on the header; column actions name the column', () => {
    const onSort = jest.fn();
    render(
      <LogsTable
        rows={rows}
        loading={false}
        columns={columns}
        onRowClick={jest.fn()}
        onSort={onSort}
        sort={{ col: 'ServiceName', dir: 'desc' } as never}
        onMoveColumn={jest.fn()}
        onRemoveColumn={jest.fn()}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /^SeverityText/ }));
    expect(onSort).toHaveBeenCalledWith('SeverityText');
    expect(screen.getAllByRole('columnheader').find((h) => h.textContent?.includes('ServiceName'))).toHaveAttribute(
      'aria-sort',
      'descending'
    );
    expect(screen.getByRole('button', { name: 'Move ServiceName right' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move SeverityText left' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove column SeverityText' })).toBeInTheDocument();
  });
});

describe('histogram bucket popover', () => {
  it('announces the dialog hint and closes on Escape', () => {
    const onClose = jest.fn();
    render(<BucketActionsPopover time={0} bucketMs={1} series={[]} clientX={0} clientY={0} onClose={onClose} />);
    const dialog = screen.getByRole('dialog', { name: 'Bucket actions' });
    expect(dialog).toHaveAccessibleDescription(DIALOG_HINT);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('Grafana Toggletip popovers are announced as dialogs', () => {
  it('Display options and the field type filter', async () => {
    render(
      <>
        <GridDisplayOptions value={DEFAULT_GRID_DISPLAY} onChange={jest.fn()} />
        <FieldTypeFilter counts={{ string: 2 }} selected={new Set()} onChange={jest.fn()} />
      </>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Display options' }));
    expect(await screen.findByRole('dialog', { name: 'Display options' })).toHaveAccessibleDescription(DIALOG_HINT);
    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Display options' }), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Display options' })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Filter by field type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Field type filter' });
    expect(dialog).toHaveAccessibleDescription(DIALOG_HINT);
    expect(within(dialog).getByRole('group', { name: 'Filter by field type' })).toBeInTheDocument();
  });

  it('the grid Expand popover carries the hint too', () => {
    const columns = [
      { id: 'A', key: 'A', sqlExpr: 'A', displayName: 'A', type: 'string', isCore: false } as SelectedColumn,
    ];
    render(<LogsTable rows={[{ A: 'x' }]} loading={false} columns={columns} onRowClick={jest.fn()} />);
    const grid = screen.getByRole('grid');
    grid.focus();
    fireEvent.keyDown(grid, { key: 'ArrowDown' });
    fireEvent.keyDown(grid, { key: 'Enter' });
    expect(screen.getByRole('dialog', { name: 'Value of A' })).toHaveAccessibleDescription(DIALOG_HINT);
  });
});
