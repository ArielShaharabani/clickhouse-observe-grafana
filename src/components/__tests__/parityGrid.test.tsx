/**
 * PARITY-GRID (Kibana comparison): grid header menu and resize handles, focus returning to the
 * row when the document panel closes, the anchor row marker; document panel keyboard (Escape,
 * ←/→), focus on open, ISO time in JSON, "View single document", names wrapping at dots; the
 * field popover's always-visible filter buttons, sample caption and in-panel back link.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { dateTime, TimeRange } from '@grafana/data';
import { LogsTable } from '../LogsTable';
import { LogDetailDrawer } from '../LogDetailDrawer';
import { FieldStatsPopover, sampleCaption, STATS_SAMPLE_SIZE } from '../FieldSidebar/FieldStatsPopover';
import { FieldItem } from '../FieldSidebar/FieldItem';
import { SourceConfigContext } from '../App/App';
import { FieldsContext } from '../FieldsContext';
import { CORE_ALIAS } from '../../sql/queryBuilder';
import { FieldModel } from '../../sql/fieldModel';
import { runQueryRows } from '../../data/runQuery';
import {
  DEFAULT_LOGS_QUERY_STATE,
  DEFAULT_SOURCE_CONFIG,
  LogRow,
  OTEL_COLUMN_MAPPING,
  SelectedColumn,
  SourceConfig,
} from '../../types';

jest.mock('../../data/runQuery');
const mockRunQueryRows = runQueryRows as jest.MockedFunction<typeof runQueryRows>;

const col = (id: string, over: Partial<SelectedColumn> = {}): SelectedColumn => ({
  id,
  key: id,
  sqlExpr: id,
  displayName: id,
  type: 'string',
  isCore: false,
  ...over,
});
const columns = [col('ServiceName'), col('SeverityText'), col('Body', { type: 'text' })];
const rows: LogRow[] = [
  { ServiceName: 'payments', SeverityText: 'error', Body: 'boom' },
  { ServiceName: 'auth', SeverityText: 'info', Body: 'ok' },
];

describe('grid header menu', () => {
  function setup(extra: Partial<React.ComponentProps<typeof LogsTable>> = {}) {
    const props = {
      onSort: jest.fn(),
      onMoveColumn: jest.fn(),
      onRemoveColumn: jest.fn(),
      onResizeColumn: jest.fn(),
    };
    render(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} {...props} {...extra} />);
    return props;
  }
  const openMenu = (name: string) => {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${name}`) }));
    return screen.getByRole('menu', { name: `Column actions: ${name}` });
  };

  it('a header click opens the menu instead of sorting', () => {
    const { onSort } = setup();
    const menu = openMenu('ServiceName');
    expect(onSort).not.toHaveBeenCalled();
    expect(within(menu).queryByRole('menuitem', { name: 'Move left' })).toBeNull(); // first column
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Sort ascending' }));
    expect(onSort).toHaveBeenCalledWith('ServiceName', 'asc');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('moves, removes and copies the name', async () => {
    const writeText = jest.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    const { onMoveColumn, onRemoveColumn } = setup();
    fireEvent.click(within(openMenu('SeverityText')).getByRole('menuitem', { name: 'Move right' }));
    expect(onMoveColumn).toHaveBeenCalledWith('SeverityText', 'right');
    fireEvent.click(within(openMenu('SeverityText')).getByRole('menuitem', { name: 'Remove column' }));
    expect(onRemoveColumn).toHaveBeenCalledWith(columns[1]);
    fireEvent.click(within(openMenu('SeverityText')).getByRole('menuitem', { name: 'Copy name' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('SeverityText'));
  });

  it('core columns offer no Remove; a resized column offers Reset width', () => {
    const { onResizeColumn } = setup({
      columns: [col('Time', { type: 'time', isCore: true, width: 300 }), ...columns],
    });
    const menu = openMenu('Time');
    expect(within(menu).queryByRole('menuitem', { name: 'Remove column' })).toBeNull();
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Reset width' }));
    expect(onResizeColumn).toHaveBeenCalledWith('Time', undefined);
  });

  it('Escape closes the menu', () => {
    setup();
    const menu = openMenu('ServiceName');
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('column resize handles', () => {
  it('arrow keys on a handle resize by a step; double-click resets', () => {
    const onResizeColumn = jest.fn();
    render(
      <LogsTable rows={rows} loading={false} columns={[col('A', { width: 200 }), col('B')]} onRowClick={jest.fn()} onResizeColumn={onResizeColumn} />
    );
    const handle = screen.getByRole('separator', { name: 'Resize column A' });
    // jsdom has no layout: the header measures 0 wide, so the step clamps at the minimum.
    fireEvent.keyDown(handle, { key: 'ArrowRight' });
    expect(onResizeColumn).toHaveBeenLastCalledWith('A', 60);
    fireEvent.doubleClick(handle);
    expect(onResizeColumn).toHaveBeenLastCalledWith('A', undefined);
  });

  it('a set width is applied to the header and its cells', () => {
    render(<LogsTable rows={rows} loading={false} columns={[col('A', { width: 240 }), col('B')]} onRowClick={jest.fn()} />);
    const th = screen.getAllByRole('columnheader').find((h) => h.textContent?.includes('A'))!;
    expect(th.style.width).toBe('240px');
    expect((document.querySelector('[data-cell="0:0"]') as HTMLElement).style.maxWidth).toBe('240px');
  });

  it('pointer drag commits the new width once, on release', () => {
    const onResizeColumn = jest.fn();
    render(<LogsTable rows={rows} loading={false} columns={[col('A'), col('B')]} onRowClick={jest.fn()} onResizeColumn={onResizeColumn} />);
    const handle = screen.getByRole('separator', { name: 'Resize column A' });
    fireEvent.pointerDown(handle, { button: 0, clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
    expect(onResizeColumn).not.toHaveBeenCalled();
    fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });
    expect(onResizeColumn).toHaveBeenCalledTimes(1);
    expect(onResizeColumn.mock.calls[0][0]).toBe('A');
  });
});

describe('grid rows', () => {
  it('marks the anchor row', () => {
    render(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} anchorRow={rows[1]} />);
    expect(document.querySelectorAll('[data-anchor="true"]')).toHaveLength(1);
  });

  it('gives focus back to the row button when the detail panel closes', () => {
    const { rerender } = render(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} selectedRow={rows[1]} />);
    (document.activeElement as HTMLElement | null)?.blur();
    rerender(<LogsTable rows={rows} loading={false} columns={columns} onRowClick={jest.fn()} selectedRow={null} />);
    expect(document.activeElement).toBe(document.querySelector('[data-expand-row="1"]'));
  });
});

const config: SourceConfig = { ...DEFAULT_SOURCE_CONFIG, datasourceUid: 'ds', columns: OTEL_COLUMN_MAPPING };
const docRow: LogRow = {
  [CORE_ALIAS.timestamp]: 1767603630123,
  Timestamp: 1767603630123,
  ServiceName: 'payments',
  'http.method': 'GET',
};

describe('document panel', () => {
  const renderDrawer = (extra: Partial<React.ComponentProps<typeof LogDetailDrawer>> = {}) => {
    const props = { onClose: jest.fn(), onPrev: jest.fn(), onNext: jest.fn() };
    render(
      <LogDetailDrawer row={docRow} detailRow={docRow} config={config} columns={[]} onAddFilter={jest.fn()} {...props} {...extra} />
    );
    return { ...props, panel: screen.getByRole('region', { name: 'Document detail' }) };
  };

  it('takes focus on open; Escape closes it', () => {
    const { onClose, panel } = renderDrawer();
    expect(document.activeElement).toBe(panel);
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('←/→ step between documents, but not while typing in the search box', () => {
    const { onPrev, onNext, panel } = renderDrawer();
    fireEvent.keyDown(panel, { key: 'ArrowRight' });
    fireEvent.keyDown(panel, { key: 'ArrowLeft' });
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onPrev).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Search field names and values' }), { key: 'ArrowRight' });
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('shows "First log" / "Last log" (navigation covers every loaded document)', () => {
    renderDrawer({ onFirst: jest.fn(), onLast: jest.fn(), navLabel: '50 of 200' });
    expect(screen.getByRole('button', { name: 'First log' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Last log' })).toBeEnabled();
    expect(screen.getByText('50 of 200')).toBeInTheDocument();
  });

  it('JSON tab shows the time as ISO 8601', () => {
    renderDrawer();
    fireEvent.click(screen.getByText('JSON'));
    expect(screen.getAllByText(/2026-01-05T09:00:30\.123Z/).length).toBeGreaterThan(0);
    expect(screen.queryByText('1767603630123')).toBeNull();
  });

  it('offers "View single document"', () => {
    const onViewSingleDocument = jest.fn();
    renderDrawer({ onViewSingleDocument });
    fireEvent.click(screen.getByRole('button', { name: 'View single document' }));
    expect(onViewSingleDocument).toHaveBeenCalled();
  });

  it('field names can wrap at the dots', () => {
    renderDrawer();
    const name = screen.getByTitle('http.method');
    expect(name.querySelector('wbr')).not.toBeNull();
    expect(name).toHaveTextContent('http.method');
  });
});

const timeRange: TimeRange = {
  from: dateTime('2026-01-01T00:00:00Z'),
  to: dateTime('2026-01-01T01:00:00Z'),
  raw: { from: 'now-1h', to: 'now' },
};
const strField: FieldModel = { id: 'col:ServiceName', name: 'ServiceName', displayName: 'ServiceName', sqlExpr: 'ServiceName', type: 'string', source: 'column' };

function withProviders(node: React.ReactNode) {
  return (
    <SourceConfigContext.Provider value={config}>
      <FieldsContext.Provider value={{ fields: [], loading: false, error: null, refresh: () => {} }}>{node}</FieldsContext.Provider>
    </SourceConfigContext.Provider>
  );
}

describe('field popover', () => {
  beforeEach(() => mockRunQueryRows.mockReset());

  it('sample caption says "sample" only when the sample cap was reached', () => {
    expect(sampleCaption('Calculated', 5000, STATS_SAMPLE_SIZE)).toBe('Calculated from 5,000 sample records.');
    expect(sampleCaption('Calculated', 1392, STATS_SAMPLE_SIZE)).toBe('Calculated from 1,392 records.');
    expect(sampleCaption('Calculated', 1, STATS_SAMPLE_SIZE)).toBe('Calculated from 1 record.');
  });

  it('every value row has filter for / out buttons and a gauge; the back link is inside the panel', async () => {
    mockRunQueryRows.mockResolvedValue([
      { v: 'payments', c: 6, total: 8 },
      { v: 'auth', c: 2, total: 8 },
    ] as never);
    const onBack = jest.fn();
    const onAddFilter = jest.fn();
    const { container } = render(
      withProviders(
        <FieldStatsPopover
          field={strField}
          queryState={DEFAULT_LOGS_QUERY_STATE}
          timeRange={timeRange}
          onAddFilter={onAddFilter}
          onAddColumn={jest.fn()}
          isSelected={false}
          back={{ label: 'ResourceAttributes', onBack }}
        />
      )
    );
    const valueRows = await screen.findAllByTestId('top-value-row');
    expect(valueRows.length).toBeGreaterThan(0);
    for (const r of valueRows) {
      expect(within(r).getAllByRole('button', { name: /^Filter (for|out) ServiceName/ })).toHaveLength(2);
    }
    // The back link is part of the bordered panel, not a stray label above it.
    const back = screen.getByRole('button', { name: 'Back to ResourceAttributes keys' });
    expect(container.firstElementChild!.contains(back)).toBe(true);
    fireEvent.click(back);
    expect(onBack).toHaveBeenCalled();
  });
});

describe('field list entry for a field a core column already shows', () => {
  it('says so instead of offering a duplicate column', () => {
    const body: FieldModel = { id: 'col:Body', name: 'Body', displayName: 'Body', sqlExpr: 'Body', type: 'string', source: 'column' };
    const onToggleColumn = jest.fn();
    render(
      withProviders(
        <FieldItem
          field={body}
          isSelected={false}
          queryState={DEFAULT_LOGS_QUERY_STATE}
          timeRange={timeRange}
          onToggleColumn={onToggleColumn}
          onAddFilter={jest.fn()}
          coreShownAs={new Map([['Body', 'Message']])}
        />
      )
    );
    expect(screen.getByLabelText('Body is shown as the Message column')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Body as column' })).toBeNull();
  });
});

// Silence act() warnings from the async popover load finishing after a test ends.
afterEach(async () => {
  await act(async () => {});
});
