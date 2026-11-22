/** R5-SAMPLING: the field popover's "Scan full range" reruns the top values over the whole range. */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { dateTime, TimeRange } from '@grafana/data';
import { FieldStatsPopover } from '../FieldStatsPopover';
import { SourceConfigContext } from '../../App/App';
import { FieldsContext } from '../../FieldsContext';
import { runQueryRows } from '../../../data/runQuery';
import { FieldModel } from '../../../sql/fieldModel';
import { DEFAULT_LOGS_QUERY_STATE, DEFAULT_SOURCE_CONFIG, SourceConfig } from '../../../types';

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
const field: FieldModel = {
  id: 'col:ServiceName',
  name: 'ServiceName',
  displayName: 'ServiceName',
  sqlExpr: 'ServiceName',
  type: 'string',
  source: 'column',
};

it('replaces the sampled values with full-range ones and labels the scan', async () => {
  mockRun.mockImplementation(async ({ sql }) => {
    if (sql.startsWith('EXPLAIN ESTIMATE')) {
      return [{ rows: 41520 }];
    }
    if (sql.includes('topKIf')) {
      return [{ total: 41520, d0: 41520, u0: 2, tv0: ['auth', 'rare-svc'], tc0: [41519, 1], te0: 0 }];
    }
    return [{ value: 'auth', count: 5000, total: 5000 }];
  });
  render(
    <SourceConfigContext.Provider value={config}>
      <FieldsContext.Provider value={{ fields: [], loading: false, error: null, refresh: () => {} }}>
        <FieldStatsPopover
          field={field}
          queryState={DEFAULT_LOGS_QUERY_STATE}
          timeRange={timeRange}
          onAddFilter={jest.fn()}
          onAddColumn={jest.fn()}
          isSelected={false}
        />
      </FieldsContext.Provider>
    </SourceConfigContext.Provider>
  );
  expect(await screen.findByText(/Calculated from 5,000 sample records/)).toBeInTheDocument();
  expect(screen.queryByText('rare-svc')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Scan full range/ }));
  expect(await screen.findByText('rare-svc')).toBeInTheDocument();
  expect(screen.getByText('Scanned 41,520 records over the full time range (complete).')).toBeInTheDocument();
});
