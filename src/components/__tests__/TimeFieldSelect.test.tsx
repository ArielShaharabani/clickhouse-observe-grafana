import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { TimeFieldSelect } from '../DataViewPicker/TimeFieldSelect';
import { ColumnMappingForm } from '../ColumnMappingForm';
import { DEFAULT_SOURCE_CONFIG, EMPTY_COLUMN_MAPPING, TimestampFormat } from '../../types';
import { buildTimeSampleQuery } from '../../sql/timeExpr';
import { buildColumnsQuery, buildTablesQuery } from '../../sql/introspection';

const COLUMNS = [
  { name: 'Timestamp', type: 'DateTime64(9)' },
  { name: 'ts_ms', type: 'Int64' },
  { name: 'ts_text', type: 'String' },
  { name: 'flag', type: 'Bool' },
];

async function openTimeSelect() {
  const input = screen.getByLabelText('Timestamp field');
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  return input;
}

describe('TimeFieldSelect (PLAN #16d)', () => {
  it('lists date/time, number and text columns, never other types', async () => {
    render(<TimeFieldSelect columns={COLUMNS} timestamp={undefined} format={undefined} onChange={jest.fn()} />);
    await openTimeSelect();
    expect(screen.getByText('— No time field')).toBeInTheDocument();
    expect(screen.getByText('Timestamp')).toBeInTheDocument();
    expect(screen.getByText('ts_ms')).toBeInTheDocument();
    expect(screen.getByText('ts_text')).toBeInTheDocument();
    expect(screen.queryByText('flag')).not.toBeInTheDocument();
    expect(screen.getByText(/number — converted from epoch/)).toBeInTheDocument();
  });

  it('picking a number column defaults to epoch ms, then applies the guessed unit', async () => {
    const onChange = jest.fn();
    const guessEpoch = jest.fn(async () => 'epoch_s' as TimestampFormat);
    render(
      <TimeFieldSelect
        columns={COLUMNS}
        timestamp={undefined}
        format={undefined}
        onChange={onChange}
        guessEpoch={guessEpoch}
      />
    );
    await openTimeSelect();
    await act(async () => {
      fireEvent.click(screen.getByText('ts_ms'));
    });
    expect(onChange).toHaveBeenNthCalledWith(1, 'ts_ms', 'epoch_ms');
    expect(guessEpoch).toHaveBeenCalledWith('ts_ms');
    expect(onChange).toHaveBeenNthCalledWith(2, 'ts_ms', 'epoch_s');
  });

  it('a text column is read as a parsed date; a date column natively; "No time field" clears', async () => {
    const onChange = jest.fn();
    render(<TimeFieldSelect columns={COLUMNS} timestamp={undefined} format={undefined} onChange={onChange} />);
    await openTimeSelect();
    fireEvent.click(screen.getByText('ts_text'));
    expect(onChange).toHaveBeenLastCalledWith('ts_text', 'string');
    await openTimeSelect();
    fireEvent.click(screen.getByText('Timestamp'));
    expect(onChange).toHaveBeenLastCalledWith('Timestamp', 'native');
    await openTimeSelect();
    fireEvent.click(screen.getByText('— No time field'));
    expect(onChange).toHaveBeenLastCalledWith('', 'native');
  });

  it('flags a converted time field and offers the epoch unit', () => {
    render(<TimeFieldSelect columns={COLUMNS} timestamp="ts_ms" format="epoch_ms" onChange={jest.fn()} />);
    expect(screen.getByTestId('converted-time-note')).toHaveTextContent(/Epoch milliseconds.*Converted time field/);
    expect(screen.getByLabelText('Epoch unit')).toBeInTheDocument();
  });

  it('a native time field shows no conversion note and no unit picker', () => {
    render(<TimeFieldSelect columns={COLUMNS} timestamp="Timestamp" format={undefined} onChange={jest.fn()} />);
    expect(screen.queryByTestId('converted-time-note')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Epoch unit')).not.toBeInTheDocument();
  });
});

describe('ColumnMappingForm omitKeys', () => {
  it('hides the keys edited elsewhere (the time field)', () => {
    render(<ColumnMappingForm value={{ ...EMPTY_COLUMN_MAPPING }} onChange={jest.fn()} omitKeys={['timestamp']} />);
    expect(screen.queryByText('Timestamp column')).not.toBeInTheDocument();
    expect(screen.getByText('Log body / message column')).toBeInTheDocument();
  });
});

describe('schema queries escape typed names', () => {
  const cfg = { ...DEFAULT_SOURCE_CONFIG, datasourceUid: 'ds', database: "db'x" };
  it('buildColumnsQuery / buildTablesQuery quote database and table as string literals', () => {
    const sql = buildColumnsQuery(cfg, "t' OR 1=1 --");
    expect(sql).toContain("database = 'db\\'x' AND table = 't\\' OR 1=1 --'");
    expect(buildTablesQuery("a\\' b")).toContain("database = 'a\\\\\\' b'");
  });
  it('buildTimeSampleQuery quotes the column and the table as identifiers', () => {
    const sql = buildTimeSampleQuery({ ...cfg, database: 'default' }, 'spec"logs', 'ts"; DROP');
    expect(sql).toContain('SELECT toString("ts""; DROP") AS v');
    expect(sql).toMatch(/FROM "?default"?\."spec""logs"/);
    expect(sql).toContain('LIMIT 1');
  });
});
