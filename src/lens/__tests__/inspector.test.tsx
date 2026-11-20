import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LensResult } from '../compile';
import { LensInspector } from '../Inspector';
import {
  cellFilterValue,
  csvField,
  csvFileName,
  inspectorTable,
  lensRequests,
  sortRows,
  toCsv,
} from '../inspectorData';
import { LensState, TermsDim } from '../state';
import { __resetForTests, startOrphanRoot } from '../../diag/tracer';

const svc: TermsDim = { kind: 'terms', id: 'b1', field: 'ServiceName', label: 'Top 9 values of ServiceName', size: 9 };
const lens: LensState = {
  chartType: 'bar',
  buckets: [svc],
  metrics: [{ kind: 'metric', id: 'm1', op: 'count' }],
};

function result(rows: Array<[string | null, number]>): LensResult {
  return {
    xs: rows.map((r) => r[0] ?? ''),
    xLabels: rows.map((r) => r[0] ?? ''),
    xSynthetic: rows.map(() => false),
    xIsTime: false,
    series: [],
    table: { columns: ['Top 9 values of ServiceName', 'Count of records'], rows },
  };
}

describe('inspector data helpers', () => {
  it('labels bucket and metric columns', () => {
    const t = inspectorTable(lens, result([['a', 1]]));
    expect(t.columns.map((c) => [c.role, c.isTime])).toEqual([
      ['bucket', false],
      ['metric', false],
    ]);
    expect(inspectorTable(lens, undefined)).toEqual({ columns: [], rows: [] });
  });

  it('filters only real top-values cells, mapping the "(value)" spelling back', () => {
    const withSynth: TermsDim = { ...svc, other: true, missing: true };
    expect(cellFilterValue(svc, 'payments')).toBe('payments');
    expect(cellFilterValue(withSynth, 'Other')).toBeNull();
    expect(cellFilterValue(withSynth, '(missing)')).toBeNull();
    expect(cellFilterValue(withSynth, 'Other (value)')).toBe('Other');
    expect(cellFilterValue(withSynth, '(missing) (value)')).toBe('(missing)');
    // Without the synthetic buckets enabled, the plain spelling is a real value.
    expect(cellFilterValue(svc, 'Other')).toBe('Other');
    expect(cellFilterValue(svc, null)).toBeNull();
    expect(cellFilterValue({ kind: 'date_histogram', id: 'd', field: 'ts', label: 't' } as never, 1)).toBeNull();
    expect(cellFilterValue(undefined, 'x')).toBeNull();
  });

  it('sorts numbers numerically and text by locale, empty cells last', () => {
    const rows: Array<Array<string | number | null>> = [
      ['b', 10],
      [null, 2],
      ['a', 9],
    ];
    expect(sortRows(rows, { col: 1, dir: 'asc' }).map((r) => r[1])).toEqual([2, 9, 10]);
    expect(sortRows(rows, { col: 1, dir: 'desc' }).map((r) => r[1])).toEqual([10, 9, 2]);
    expect(sortRows(rows, { col: 0, dir: 'asc' }).map((r) => r[0])).toEqual(['a', 'b', null]);
    expect(sortRows(rows, { col: 0, dir: 'desc' }).map((r) => r[0])).toEqual(['b', 'a', null]);
    expect(sortRows(rows, null)).toBe(rows);
  });

  it('writes CSV safely: quoting and no spreadsheet formulas', () => {
    expect(csvField('plain')).toBe('plain');
    expect(csvField('a,b')).toBe('"a,b"');
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
    expect(csvField('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvField('+1')).toBe("'+1");
    expect(csvField('-cmd')).toBe("'-cmd");
    expect(csvField('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvField(-5)).toBe('-5');
    expect(csvField(null)).toBe('');
    expect(csvField(NaN)).toBe('');
  });

  it('exports raw and formatted CSV', () => {
    const dateLens: LensState = {
      ...lens,
      buckets: [{ kind: 'date_histogram', id: 'd', field: 'Timestamp', label: 'Timestamp' } as never],
    };
    const t = inspectorTable(dateLens, {
      ...result([]),
      table: { columns: ['Timestamp', 'Count of records'], rows: [[Date.UTC(2026, 0, 1), 12345]] },
    });
    expect(toCsv(t, false)).toBe(`Timestamp,Count of records\r\n${Date.UTC(2026, 0, 1)},12345\r\n`);
    const formatted = toCsv(t, true).split('\r\n')[1];
    expect(formatted).toMatch(/^2026-01-01 \d\d:00:00,"12,345"$|^2025-12-31 \d\d:00:00,"12,345"$/);
  });

  it('names the file after the chart, safely', () => {
    const name = csvFileName('Count of records over ../time', true, new Date('2026-11-18T10:20:30Z'));
    expect(name).toBe('Count_of_records_over_.._time-formatted-2026-11-18-10-20-30.csv');
    expect(csvFileName('***', false, new Date('2026-11-18T10:20:30Z'))).toBe(
      'visualization-raw-2026-11-18-10-20-30.csv'
    );
  });
});

describe('LensInspector', () => {
  beforeEach(() => __resetForTests());

  const rows: Array<[string, number]> = Array.from({ length: 25 }, (_, i) => [`svc-${String(i).padStart(2, '0')}`, i]);

  it('shows the data table with sortable headers, pagination and cell filter actions', () => {
    const addFilter = jest.fn();
    render(
      <LensInspector
        lens={lens}
        data={result(rows)}
        title="Bar"
        tableName="default.spec_logs"
        addFilter={addFilter}
        onClose={() => undefined}
      />
    );
    const table = screen.getByRole('table', { name: 'Inspector data' });
    // 20 rows per page (+ header row).
    expect(within(table).getAllByRole('row')).toHaveLength(21);
    expect(screen.getByText('25 rows')).toBeInTheDocument();

    fireEvent.click(within(table).getByRole('button', { name: /Count of records/ }));
    fireEvent.click(within(table).getByRole('button', { name: /Count of records/ }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('svc-24');
    expect(within(table).getByRole('columnheader', { name: /Count of records/ })).toHaveAttribute(
      'aria-sort',
      'descending'
    );

    fireEvent.click(screen.getByRole('button', { name: /Filter for .*: svc-24/ }));
    expect(addFilter).toHaveBeenCalledWith(expect.objectContaining({ field: 'ServiceName', value: 'svc-24', op: '=' }));
    fireEvent.click(screen.getByRole('button', { name: /Filter out .*: svc-23/ }));
    expect(addFilter).toHaveBeenLastCalledWith(
      expect.objectContaining({ field: 'ServiceName', value: 'svc-23', op: '!=' })
    );
    // Metric cells have no filter actions.
    expect(screen.queryByRole('button', { name: /Filter for Count of records/ })).toBeNull();
  });

  it('shows the latest chart request from the diagnostics tracer', () => {
    const span = startOrphanRoot('lens');
    span.setAttrs({ sql: 'SELECT count() FROM t', rowCount: 3, serverReadRows: 41520 });
    span.end('ok');
    startOrphanRoot('logs').end('ok'); // not a Visualize request
    render(
      <LensInspector
        lens={lens}
        data={result([['a', 1]])}
        title="Bar"
        dataView={{ id: 'spec', name: 'Spec fixture logs' }}
        tableName="default.spec_logs"
        addFilter={() => undefined}
        onClose={() => undefined}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Requests' }));
    expect(screen.getByText('1 request was made')).toBeInTheDocument();
    const stats = screen.getByRole('table', { name: 'Request statistics' });
    expect(within(stats).getByRole('row', { name: /Result rows 3/ })).toBeInTheDocument();
    expect(within(stats).getByRole('row', { name: /Rows read 41,520|Rows read 41.5K/ })).toBeInTheDocument();
    expect(within(stats).getByRole('row', { name: /Data view Spec fixture logs/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Request' }));
    expect(screen.getByLabelText('Inspector request')).toHaveTextContent('SELECT count() FROM t');
    fireEvent.click(screen.getByRole('tab', { name: 'Response' }));
    expect(screen.getByLabelText('Inspector response')).toHaveTextContent('"rows"');
  });

  it('says so when nothing ran yet', () => {
    render(
      <LensInspector
        lens={lens}
        title="Bar"
        tableName="default.spec_logs"
        addFilter={() => undefined}
        onClose={() => undefined}
      />
    );
    expect(screen.getByText('No data to show yet.')).toBeInTheDocument();
    act(() => {
      fireEvent.click(screen.getByRole('radio', { name: 'Requests' }));
    });
    expect(screen.getByText('No request has been made yet.')).toBeInTheDocument();
  });

  it('lists only Visualize roots', () => {
    const a = startOrphanRoot('lens');
    startOrphanRoot('volume');
    expect(lensRequests([a.span]).length).toBe(1);
  });
});
