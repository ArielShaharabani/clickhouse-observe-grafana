import React, { useState } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SearchBar } from '../SearchBar';
import { FieldsContext } from '../FieldsContext';
import { FilterPills } from '../FilterPills';
import { NoResults } from '../NoResults';
import { FieldModel } from '../../sql/fieldModel';
import { FilterPill } from '../../types';

const col = (name: string): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type: 'string',
  source: 'column',
});

function bar(onInvalidQuery?: (m: string | null) => void) {
  render(
    <FieldsContext.Provider value={{ fields: [col('ServiceName')], loading: false, error: null, refresh: () => {} }}>
      <SearchBar
        value=""
        onChange={() => {}}
        onSearch={() => {}}
        loadValues={async () => []}
        loadMapKeys={async () => ({ keys: [], total: 0 })}
        onInvalidQuery={onInvalidQuery}
      />
    </FieldsContext.Provider>
  );
  return screen.getByPlaceholderText(/filter logs with kql/i) as HTMLInputElement;
}

describe('SearchBar (PARITY-FIELDS)', () => {
  it('warns about a field that does not exist in the data view', async () => {
    const input = bar();
    fireEvent.change(input, { target: { value: 'nosuchfield : x', selectionStart: 15 } });
    fireEvent.keyDown(input, { key: 'Escape' });
    const warn = await screen.findByTestId('kql-unknown-field');
    expect(warn).toHaveTextContent('nosuchfield');
    expect(warn).toHaveTextContent("doesn't exist");
  });

  it('does not warn for a known field', async () => {
    const input = bar();
    fireEvent.change(input, { target: { value: 'ServiceName : x', selectionStart: 15 } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('kql-unknown-field')).toBeNull();
  });

  it('reports an invalid query on commit and clears it on a valid one', () => {
    const onInvalid = jest.fn();
    const input = bar(onInvalid);
    fireEvent.change(input, { target: { value: 'ServiceName : (', selectionStart: 15 } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInvalid).toHaveBeenLastCalledWith(expect.stringMatching(/expected/i));
    fireEvent.change(input, { target: { value: 'ServiceName : a', selectionStart: 15 } });
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onInvalid).toHaveBeenLastCalledWith(null);
  });
});

describe('NoResults', () => {
  it('shows tips and searches the entire time range', async () => {
    const search = jest.fn().mockResolvedValue(true);
    render(<NoResults onSearchEntireRange={search} />);
    expect(screen.getByText('No results match your search criteria')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search entire time range' }));
    await waitFor(() => expect(search).toHaveBeenCalled());
  });

  it('says so when the data view has no documents', async () => {
    render(<NoResults onSearchEntireRange={async () => false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search entire time range' }));
    expect(await screen.findByText('This data view has no documents.')).toBeInTheDocument();
  });

  it('shows the error instead of the tips', () => {
    render(<NoResults error="Expected value" />);
    expect(screen.getByTestId('results-error')).toHaveTextContent('Expected value');
    expect(screen.queryByTestId('no-results')).toBeNull();
  });
});

describe('FilterPills groups and bulk menu', () => {
  const p = (id: string, value: string): FilterPill => ({ id, field: 'ServiceName', op: '=', value });
  function Host({ initial }: { initial: FilterPill[] }) {
    const [filters, setFilters] = useState(initial);
    return <FilterPills filters={filters} onChange={setFilters} loadValues={async () => []} pinTable="db.t" />;
  }

  it('groups a pill with the next one (OR) and ungroups', () => {
    render(<Host initial={[p('a', 'x'), p('b', 'y')]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Filter actions: ServiceName = x/ }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Filter actions' })).getByRole('menuitem', { name: /Group with next filter/ }));
    expect(document.querySelectorAll('[data-group][data-group-op="or"]')).toHaveLength(2);
    expect(screen.getByTestId('filter-pills')).toHaveTextContent('OR');
    fireEvent.click(screen.getByRole('button', { name: /^Filter actions: ServiceName = x/ }));
    fireEvent.click(within(screen.getByRole('menu', { name: 'Filter actions' })).getByRole('menuitem', { name: /Remove from group/ }));
    expect(document.querySelectorAll('[data-group]')).toHaveLength(0);
  });

  it('bulk menu: disable all, then remove all', () => {
    render(<Host initial={[p('a', 'x'), p('b', 'y')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'All filters actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable all' }));
    expect(screen.getAllByRole('button', { name: /\(disabled\)/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'All filters actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove all' }));
    expect(screen.queryByTestId('filter-pills')).toBeNull();
  });
});
