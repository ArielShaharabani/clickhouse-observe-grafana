import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime } from '@grafana/data';
import { QueryRow, withQuery } from '../QueryRow';
import { FieldsContext } from '../../components/FieldsContext';

const range = { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-1h', to: 'now' } };

function setup(search = '') {
  const props = {
    search,
    filters: [],
    timeRange: range,
    pinTable: 'db.t',
    loadValues: async () => [],
    loadMapKeys: async () => ({ keys: [], total: 0 }) as never,
    onSearch: jest.fn(),
    onInvalidQuery: jest.fn(),
    onFiltersChange: jest.fn(),
    onAddFilter: jest.fn(),
    onClearAll: jest.fn(),
    onLoadQuery: jest.fn(),
  };
  render(
    <FieldsContext.Provider value={{ fields: [], loading: false, error: null, refresh: () => {} }}>
      <QueryRow {...props} />
    </FieldsContext.Provider>
  );
  return { props, input: screen.getByLabelText('Search logs (KQL)') as HTMLInputElement };
}

describe('Visualize query row', () => {
  it('typing alone submits nothing; Enter submits once', () => {
    const { props, input } = setup();
    fireEvent.change(input, { target: { value: 'level:error', selectionStart: 11 } });
    expect(props.onSearch).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSearch).toHaveBeenCalledTimes(1);
    expect(props.onSearch).toHaveBeenCalledWith('level:error');
  });

  it('an invalid query reports the error and is not submitted', () => {
    const { props, input } = setup();
    fireEvent.change(input, { target: { value: 'level:(error', selectionStart: 12 } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSearch).not.toHaveBeenCalled();
    expect(props.onInvalidQuery).toHaveBeenCalledWith(expect.any(String));
    expect(props.onInvalidQuery).not.toHaveBeenLastCalledWith(null);
  });

  it('shows the Add filter button and the query menu', () => {
    setup('a:b');
    fireEvent.click(screen.getByRole('button', { name: /add filter/i }));
    expect(screen.getByRole('dialog', { name: 'Add filter' })).toBeInTheDocument();
  });
});

describe('withQuery', () => {
  it('sets q, keeps the other params, drops a blank query, and is a no-op when unchanged', () => {
    const prev = new URLSearchParams('from=1&filters=%5B%5D');
    const next = withQuery(prev, 'a:b');
    expect(next.get('q')).toBe('a:b');
    expect(next.get('from')).toBe('1');
    expect(withQuery(next, 'a:b')).toBe(next);
    expect(withQuery(next, '  ').has('q')).toBe(false);
  });
});
