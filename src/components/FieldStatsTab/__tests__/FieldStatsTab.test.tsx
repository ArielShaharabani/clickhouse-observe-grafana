/** DISC-FIELDSTATS-01 Field statistics tab: one batch query per page of fields, table columns,
 *  mini distributions, expanded row, filter and Visualize actions. */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TimeRange, dateTime } from '@grafana/data';
import { FieldStatsTab, FIELD_STATS_PAGE_SIZE, isProfilableField } from '../FieldStatsTab';
import { runQueryRows } from '../../../data/runQuery';
import { SourceConfigContext } from '../../App/App';
import { FieldsContext } from '../../FieldsContext';
import { DEFAULT_LOGS_QUERY_STATE, DEFAULT_SOURCE_CONFIG, SourceConfig } from '../../../types';
import { FieldModel } from '../../../sql/fieldModel';

jest.mock('../../../data/runQuery');
const mockRun = runQueryRows as jest.MockedFunction<typeof runQueryRows>;

const config: SourceConfig = {
  ...DEFAULT_SOURCE_CONFIG,
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'spec_logs',
};
const timeRange: TimeRange = {
  from: dateTime('2026-01-01T00:00:00Z'),
  to: dateTime('2026-01-08T00:00:00Z'),
  raw: { from: 'a', to: 'b' },
};

const col = (name: string, type: FieldModel['type']): FieldModel => ({
  id: `col:${name}`,
  name,
  displayName: name,
  sqlExpr: name,
  type,
  source: 'column',
});
const sev = col('SeverityText', 'string');
const num = col('SeverityNumber', 'number');
const attrs = col('LogAttributes', 'map');

// Row for targets [SeverityNumber, SeverityText] (sorted by name).
const row = {
  total: 5000,
  d0: 5000,
  u0: 4,
  tv0: ['9', '13', '5', '17'],
  tc0: [3483, 792, 487, 238],
  nn0: 5000,
  lo0: 5,
  hi0: 17,
  med0: 9,
  bk0: [487, 0, 0, 3483, 0, 0, 792, 0, 0, 238],
  d1: 5000,
  u1: 4,
  tv1: ['info', 'warn', 'debug', 'error'],
  tc1: [3483, 792, 487, 238],
};

function renderTab(fields: FieldModel[], props: Partial<React.ComponentProps<typeof FieldStatsTab>> = {}) {
  const onAddFilter = jest.fn();
  const onVisualize = jest.fn();
  render(
    <SourceConfigContext.Provider value={config}>
      <FieldsContext.Provider value={{ fields, loading: false, error: null, refresh: () => {} }}>
        <FieldStatsTab
          queryState={DEFAULT_LOGS_QUERY_STATE}
          timeRange={timeRange}
          onAddFilter={onAddFilter}
          onVisualize={onVisualize}
          {...props}
        />
      </FieldsContext.Provider>
    </SourceConfigContext.Provider>
  );
  return { onAddFilter, onVisualize };
}

beforeEach(() => mockRun.mockReset());

it('profiles all listed fields in one batch query, sorted by name, containers excluded', async () => {
  mockRun.mockResolvedValue([row]);
  renderTab([sev, attrs, num]);
  expect(await screen.findAllByText('5,000 (100%)')).toHaveLength(2);
  expect(mockRun).toHaveBeenCalledTimes(1);
  const { sql, op } = mockRun.mock.calls[0][0];
  expect(op).toBe('fieldStats');
  expect(sql).toContain('toString(SeverityNumber) AS v0');
  expect(sql).toContain('toString(SeverityText) AS v1');
  expect(sql).not.toContain('LogAttributes');
  expect(sql).toContain('LIMIT 5000');
  expect(screen.getByText('4 categories')).toBeInTheDocument();
  expect(screen.getByLabelText('SeverityNumber distribution from 5 to 17')).toBeInTheDocument();
  expect(screen.getByText(/Calculated from 5,000 sample records/)).toBeInTheDocument();
});

it('expanded row: document stats, numeric summary, top values with filter actions', async () => {
  mockRun.mockResolvedValue([row]);
  const { onAddFilter } = renderTab([sev, num]);
  await screen.findAllByText('5,000 (100%)');
  fireEvent.click(screen.getByRole('button', { name: 'Expand SeverityNumber' }));
  const panel = screen.getByTestId('field-stats-expanded-SeverityNumber');
  expect(panel).toHaveTextContent('median9');
  expect(panel).toHaveTextContent('3,483 (69.7%)');
  expect(screen.getByLabelText('5 to 6.2: 487 records')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Filter for SeverityNumber: 9' }));
  expect(onAddFilter).toHaveBeenCalledWith(expect.objectContaining({ field: 'SeverityNumber', value: '9' }));
});

it('Visualize action hands the field to Lens', async () => {
  mockRun.mockResolvedValue([row]);
  const { onVisualize } = renderTab([sev, num]);
  fireEvent.click(await screen.findByRole('button', { name: 'Visualize SeverityText' }));
  expect(onVisualize).toHaveBeenCalledWith(sev);
});

it('eye toggle hides the distributions column; name filter narrows and requeries', async () => {
  mockRun.mockResolvedValue([row]);
  renderTab([sev, num]);
  await screen.findAllByText('5,000 (100%)');
  fireEvent.click(screen.getByLabelText('Show distributions'));
  expect(screen.queryByText('Distributions', { selector: 'th' })).not.toBeInTheDocument();
  mockRun.mockResolvedValue([{ total: 5000, d0: 5000, u0: 4, tv0: [], tc0: [] }]);
  fireEvent.change(screen.getByLabelText('Filter fields by name'), { target: { value: 'text' } });
  await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(2));
  expect(mockRun.mock.calls[1][0].sql).not.toContain('SeverityNumber');
  expect(screen.queryByText('SeverityNumber')).not.toBeInTheDocument();
});

it('pages fields in batches of FIELD_STATS_PAGE_SIZE', async () => {
  mockRun.mockResolvedValue([{ total: 10 }]);
  const many = Array.from({ length: FIELD_STATS_PAGE_SIZE + 3 }, (_, i) =>
    col(`f${String(i).padStart(2, '0')}`, 'string')
  );
  renderTab(many);
  await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
  expect(mockRun.mock.calls[0][0].sql).toContain(`AS v${FIELD_STATS_PAGE_SIZE - 1}`);
  expect(mockRun.mock.calls[0][0].sql).not.toContain(`AS v${FIELD_STATS_PAGE_SIZE}`);
});

it('shows the query error', async () => {
  mockRun.mockRejectedValue(new Error('boom'));
  renderTab([sev]);
  expect(await screen.findByText(/boom/)).toBeInTheDocument();
});

it('isProfilableField excludes map / json / tuple containers only', () => {
  expect(isProfilableField(attrs)).toBe(false);
  expect(isProfilableField(col('J', 'json'))).toBe(false);
  expect(isProfilableField({ ...sev, id: 'json:P:a', source: 'json' })).toBe(true);
  expect(isProfilableField(sev)).toBe(true);
});

it('R5-JSON: a missing JSON path counts as absent, not as a blank value', async () => {
  mockRun.mockResolvedValue([{ total: 10, d0: 0, u0: 0, tv0: [], tc0: [], nn0: 0 }]);
  const path: FieldModel = {
    id: 'json:Payload:request.ms',
    name: 'request.ms',
    displayName: 'Payload.request.ms',
    sqlExpr: 'Payload.request.ms.:Int64',
    type: 'number',
    source: 'json',
    jsonColumn: 'Payload',
    jsonPath: 'request.ms',
  };
  renderTab([path]);
  await waitFor(() => expect(mockRun).toHaveBeenCalled());
  expect(mockRun.mock.calls[0][0].sql).toContain("ifNull(toString(Payload.request.ms.:Int64), '') AS v0");
});
