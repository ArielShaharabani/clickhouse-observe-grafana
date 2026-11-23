import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dateTime, TimeRange } from '@grafana/data';
import { QueryMenu, toTimeRange } from '../QueryMenu/QueryMenu';
import { addSavedQuery, loadSavedQueries } from '../../data/savedQueries';
import { FilterPill } from '../../types';

const range: TimeRange = { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-1h', to: 'now' } };
const pill: FilterPill = { id: 'a', field: 'ServiceName', op: '=', value: 'payments' };

function setup(props: Partial<React.ComponentProps<typeof QueryMenu>> = {}) {
  const handlers = { onFiltersChange: jest.fn(), onClearAll: jest.fn(), onLoadQuery: jest.fn() };
  render(
    <QueryMenu
      query="SeverityText : error"
      filters={[pill]}
      timeRange={range}
      dataViewId="v1"
      pinTable="default.otel_logs"
      {...handlers}
      {...props}
    />
  );
  return handlers;
}

const openMenu = async () => {
  fireEvent.click(screen.getByRole('button', { name: 'Query menu' }));
  return screen.findByRole('menu', { name: 'Query menu' });
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('QueryMenu (DISC-SEARCH-03)', () => {
  it('saves the query with filters and time, then loads it back', async () => {
    const h = setup();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save query' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'Payment errors' } });
    fireEvent.click(screen.getByLabelText('Include time filter'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const [saved] = loadSavedQueries('v1');
    expect(saved).toMatchObject({
      name: 'Payment errors',
      query: 'SeverityText : error',
      filters: [pill],
      timeRange: { from: 'now-1h', to: 'now' },
      dataViewId: 'v1',
    });

    await openMenu();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Load query' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Payment errors' }));
    expect(h.onLoadQuery).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'SeverityText : error', filters: [pill], timeRange: expect.anything() })
    );

    // After a load, the menu offers "Save changes" and "Save as new".
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Save changes to "Payment errors"' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Save as new query' })).toBeInTheDocument();
  });

  it('rejects a duplicate name', async () => {
    addSavedQuery({ name: 'Errors', query: '', dataViewId: 'v1' });
    setup();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save query' }));
    fireEvent.change(screen.getByLabelText('Saved query name'), { target: { value: 'errors' } });
    expect(screen.getByText('Name conflicts with an existing saved query')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('Apply to all and Clear all', async () => {
    const h = setup();
    await openMenu();
    fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Apply to all' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Disable all' }));
    expect(h.onFiltersChange).toHaveBeenCalledWith([{ ...pill, disabled: true }]);

    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Clear all' }));
    expect(h.onClearAll).toHaveBeenCalled();
  });

  it('has no language switch (Lucene is not implemented)', async () => {
    setup({ filters: [] });
    await openMenu();
    expect(screen.queryByText('Language')).toBeNull();
    expect(screen.queryByRole('menuitemradio')).toBeNull();
    expect(screen.queryByText(/Lucene|KQL/)).toBeNull();
    // Nothing to apply on, nothing saved yet.
    expect(screen.queryByRole('menuitem', { name: 'Apply to all' })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('menuitem', { name: 'Load query' })).toHaveAttribute('data-disabled', 'true')
    );
  });

  it('toTimeRange keeps relative bounds and rejects garbage', () => {
    expect(toTimeRange({ from: 'now-1h', to: 'now' })?.raw).toEqual({ from: 'now-1h', to: 'now' });
    expect(toTimeRange({ from: '1700000000000', to: '1700000060000' })?.from.valueOf()).toBe(1700000000000);
    expect(toTimeRange({ from: 'garbage', to: 'now' })).toBeUndefined();
  });
});
