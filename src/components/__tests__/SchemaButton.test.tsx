import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FieldsContext } from '../FieldsContext';
import { SchemaButton } from '../SchemaButton';

const fields = [
  { id: 'col:Body', name: 'Body', displayName: 'Body', sqlExpr: 'Body', type: 'string', source: 'column', rawType: 'String' },
  { id: 'col:LogAttributes', name: 'LogAttributes', displayName: 'LogAttributes', sqlExpr: 'LogAttributes', type: 'string', source: 'column', rawType: 'Map(LowCardinality(String), String)' },
  { id: 'map:LogAttributes.k', name: 'LogAttributes.k', displayName: 'k', sqlExpr: "LogAttributes['k']", type: 'string', source: 'map' },
] as never[];

function setup() {
  render(
    <FieldsContext.Provider value={{ fields, loading: false, error: null, refresh: () => {} }}>
      <SchemaButton />
    </FieldsContext.Provider>
  );
}

describe('SchemaButton', () => {
  it('lists the columns with their ClickHouse types, not derived fields', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show schema' }));
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Map(LowCardinality(String), String)')).toBeInTheDocument();
    expect(screen.queryByText('LogAttributes.k')).not.toBeInTheDocument();
  });

  it('filters by name or type', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Show schema' }));
    fireEvent.change(screen.getByLabelText('Filter schema columns'), { target: { value: 'map(' } });
    expect(screen.queryByText('Body')).not.toBeInTheDocument();
    expect(screen.getByText('LogAttributes')).toBeInTheDocument();
  });
});
