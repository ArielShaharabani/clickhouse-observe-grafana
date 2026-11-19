import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dateTime, TimeRange } from '@grafana/data';
import { SessionActions } from '../SessionActions/SessionActions';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';

jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  getAppEvents: () => ({ publish: jest.fn() }),
  config: { bootData: { user: { orgRole: 'Admin' } } },
}));

const mockShorten = jest.fn((url: string) => Promise.resolve(`http://localhost/goto/s${url.length}`));
jest.mock('../../data/shortUrl', () => ({ shortenUrl: (url: string) => mockShorten(url) }));

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: OTEL_COLUMN_MAPPING,
};

const tr: TimeRange = {
  from: dateTime(1_700_000_000_000),
  to: dateTime(1_700_000_900_000),
  raw: { from: 'now-15m', to: 'now' },
};

function renderIt() {
  window.history.replaceState({}, '', '/a/app/explore?q=error&from=now-15m&to=now&ds=v1&traceId=t');
  const onOpenDiagnostics = jest.fn();
  render(
    <SessionActions
      config={config}
      queryState={{ ...DEFAULT_LOGS_QUERY_STATE, search: 'error' }}
      timeRange={tr}
      viewId="v1"
      viewName="OTel"
      onOpenDiagnostics={onOpenDiagnostics}
    />
  );
  return { onOpenDiagnostics };
}

describe('SessionActions', () => {
  beforeEach(() => localStorage.clear());

  it('shares the relative link by default and the absolute one when toggled', async () => {
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(screen.getByText('Share this Discover session')).toBeInTheDocument();
    // Full link while "Short link" is off.
    fireEvent.click(document.getElementById('share-short-link')!);
    const link = screen.getByLabelText('Share link') as HTMLInputElement;
    expect(link.value).toContain('from=now-15m');
    expect(link.value).not.toContain('traceId');
    fireEvent.click(document.getElementById('share-absolute-time')!);
    expect((screen.getByLabelText('Share link') as HTMLInputElement).value).toContain(`from=${tr.from.valueOf()}`);
    expect(screen.getByText('You have unsaved changes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
    await act(async () => undefined);
  });

  it('copies a Grafana short link (/goto/) by default, made from the full link', async () => {
    mockShorten.mockClear();
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() =>
      expect((screen.getByLabelText('Share link') as HTMLInputElement).value).toMatch(/\/goto\/s\d+$/)
    );
    expect(mockShorten).toHaveBeenCalledWith(expect.stringContaining('from=now-15m'));
    expect(mockShorten.mock.calls[0][0]).not.toContain('traceId');
  });

  it('hides the unsaved warning when a saved search matches', () => {
    localStorage.setItem(
      'poortuna-clickhouse-observe:saved-searches',
      JSON.stringify([
        { id: 's', name: 'e', search: 'error', filters: [], columns: [], createdAt: '', dataViewId: 'v1' },
      ])
    );
    renderIt();
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    expect(screen.queryByText('You have unsaved changes')).toBeNull();
  });

  it('lists the overflow actions and opens Inspect', () => {
    const { onOpenDiagnostics } = renderIt();
    fireEvent.click(screen.getByRole('button', { name: 'More Discover actions' }));
    for (const label of ['New session', 'Export tab results (CSV)', 'Create alert rule']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    fireEvent.click(screen.getByText('Inspect'));
    expect(onOpenDiagnostics).toHaveBeenCalled();
  });
});
