/**
 * PARITY-DASHBOARDS UI: Save and return (Visualize), the Add to dashboard dialog (panel titles,
 * duplicate title, Discover's time range, columns + Open in Discover source), and the Saved
 * searches menu button.
 */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { dateTime, TimeRange } from '@grafana/data';
import { DEFAULT_LOGS_QUERY_STATE, OTEL_COLUMN_MAPPING, SourceConfig } from '../../types';
import { defaultColumns } from '../../data/columns';
import * as dashboards from '../../data/dashboards';
import { SaveLensModal, ReturnTarget } from '../../lens/SaveLensModal';
import { SaveActions } from '../../lens/SaveActions';
import { AddToDashboardModal } from '../AddToDashboard/AddToDashboardModal';
import { SavedSearchMenu } from '../SavedSearches/SavedSearchMenu';
import { FieldsContext } from '../FieldsContext';

const mockPush = jest.fn();
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  locationService: { push: (p: string) => mockPush(p) },
  getAppEvents: () => ({ publish: jest.fn() }),
  config: { bootData: { user: { orgRole: 'Admin' } }, appSubUrl: '' },
}));
jest.mock('../../data/dashboards', () => {
  const actual = jest.requireActual('../../data/dashboards');
  return {
    ...actual,
    getDashboard: jest.fn(),
    saveDashboard: jest.fn(),
    searchDashboards: jest.fn(),
    findDashboardsByTitle: jest.fn(),
    createLibraryPanel: jest.fn(),
    deleteLibraryPanel: jest.fn(),
  };
});
jest.mock('../../data/shortUrl', () => ({ shortenUrl: (u: string) => Promise.resolve(u) }));
const api = dashboards as jest.Mocked<typeof dashboards>;

const config: SourceConfig = {
  datasourceUid: 'ds',
  database: 'default',
  logsTable: 'otel_logs',
  isOtel: true,
  columns: OTEL_COLUMN_MAPPING,
};
const tr: TimeRange = {
  from: dateTime(Date.UTC(2026, 0, 5, 8)),
  to: dateTime(Date.UTC(2026, 0, 5, 12)),
  raw: { from: dateTime(Date.UTC(2026, 0, 5, 8)), to: dateTime(Date.UTC(2026, 0, 5, 12)) },
};
const dashboard = {
  title: 'Ops',
  version: 3,
  panels: [{ id: 5, type: 'barchart', title: 'Errors by service', description: 'mine', gridPos: { x: 4, y: 2, w: 8, h: 9 } }],
};
const buildPanel = (title: string, description: string) => ({
  id: 1,
  type: 'timeseries',
  title,
  description,
  gridPos: { x: 0, y: 0, w: 12, h: 8 },
  datasource: { type: 'grafana-clickhouse-datasource', uid: 'ds' },
  targets: [],
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Save and return (Visualize opened from a dashboard panel)', () => {
  const target: ReturnTarget = {
    uid: 'u1',
    panelId: 5,
    from: 'now-6h',
    to: 'now',
    dashboard,
    dashboardTitle: 'Ops',
    panelTitle: 'Errors by service',
    panelDescription: 'mine',
  };

  it("keeps the panel's title, replaces it in place and returns with the dashboard's time", async () => {
    api.saveDashboard.mockResolvedValue({ uid: 'u1', url: '/d/u1/ops' });
    render(
      <SaveLensModal
        isOpen
        onDismiss={jest.fn()}
        defaultTitle="Count of records by ServiceName"
        buildPanel={buildPanel}
        timeRange={tr}
        canSaveDashboards
        returnTo={target}
      />
    );
    expect((screen.getByLabelText(/^Title/) as HTMLInputElement).value).toBe('Errors by service');
    expect((screen.getByLabelText(/^Description/) as HTMLTextAreaElement).value).toBe('mine');
    expect(screen.queryByText('Add to dashboard')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
    });
    const [saved, opts] = api.saveDashboard.mock.calls[0];
    expect(opts).toEqual({ folderUid: undefined, overwrite: false });
    expect(saved.panels).toEqual([
      expect.objectContaining({ id: 5, title: 'Errors by service', gridPos: { x: 4, y: 2, w: 8, h: 9 } }),
    ]);
    expect(mockPush).toHaveBeenCalledWith('/d/u1?from=now-6h&to=now');
  });

  it('a version conflict is explained, nothing navigates', async () => {
    api.saveDashboard.mockRejectedValue({ status: 412, data: { status: 'version-mismatch' } });
    render(
      <SaveLensModal isOpen onDismiss={jest.fn()} defaultTitle="x" buildPanel={buildPanel} timeRange={tr} canSaveDashboards returnTo={target} />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
    });
    expect(screen.getByText(/Someone else changed this dashboard/)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('Save as new switches to the usual destinations, still with the panel title', () => {
    render(
      <SaveLensModal isOpen onDismiss={jest.fn()} defaultTitle="x" buildPanel={buildPanel} timeRange={tr} canSaveDashboards returnTo={target} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save as new' }));
    expect(screen.getByText('Add to dashboard')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save and go to dashboard' })).toBeInTheDocument();
    expect((screen.getByLabelText(/^Dashboard title/) as HTMLInputElement).value).toBe('Errors by service');
  });

  it('toolbar: Cancel goes back unchanged; Save and return waits for the dashboard', async () => {
    api.getDashboard.mockResolvedValue({ dashboard, meta: { folderUid: 'f' } });
    render(
      <SaveActions
        paramsKey="lens=x&dash=u1&panel=5&dfrom=now-6h&dto=now"
        disabled={false}
        defaultTitle="x"
        buildPanel={buildPanel}
        timeRange={tr}
      />
    );
    expect(screen.queryByRole('button', { name: /^Save$/ })).toBeNull();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save and return' })).not.toHaveAttribute('aria-disabled', 'true')
    );
    expect(api.getDashboard).toHaveBeenCalledWith('u1');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockPush).toHaveBeenCalledWith('/d/u1?from=now-6h&to=now');
    expect(api.saveDashboard).not.toHaveBeenCalled();
  });

  const renderToolbar = (paramsKey: string) =>
    render(
      <SaveActions paramsKey={paramsKey} disabled={false} defaultTitle="x" buildPanel={buildPanel} timeRange={tr} />
    );
  const loadedBar = async (paramsKey: string) => {
    api.getDashboard.mockResolvedValue({ dashboard, meta: { folderUid: 'f' } });
    const view = renderToolbar(paramsKey);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save and return' })).not.toHaveAttribute('aria-disabled', 'true')
    );
    return view;
  };

  it('toolbar: Save and return is one click (no dialog), keeps the panel title and goes back', async () => {
    api.saveDashboard.mockResolvedValue({ uid: 'u1', url: '/d/u1/ops' });
    await loadedBar('lens=x&dash=u1&panel=5&dfrom=now-6h&dto=now');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    const [saved, opts] = api.saveDashboard.mock.calls[0];
    expect(opts).toEqual({ folderUid: 'f', overwrite: false });
    expect((saved as { panels: unknown[] }).panels[0]).toEqual(expect.objectContaining({ id: 5, title: 'Errors by service' }));
    expect(mockPush).toHaveBeenCalledWith('/d/u1?from=now-6h&to=now');
  });

  it('toolbar: a concurrent change is reported in the dialog, nothing is overwritten or navigated', async () => {
    api.saveDashboard.mockRejectedValue({ status: 412, data: { status: 'version-mismatch' } });
    await loadedBar('lens=x&dash=u1&panel=5&dfrom=now-6h&dto=now');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save and return' }));
    });
    expect(screen.getByText(/Someone else changed this dashboard/)).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('toolbar: Cancel asks to discard only when the chart changed since the panel opened', async () => {
    const { rerender } = await loadedBar('lens=x&q=a&dash=u1&panel=5&dfrom=now-6h&dto=now');
    // A time-range change is not a chart change.
    rerender(
      <SaveActions
        paramsKey="lens=x&q=a&from=now-1h&to=now&dash=u1&panel=5&dfrom=now-6h&dto=now"
        disabled={false}
        defaultTitle="x"
        buildPanel={buildPanel}
        timeRange={tr}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockPush).toHaveBeenCalledWith('/d/u1?from=now-6h&to=now');
    mockPush.mockClear();
    rerender(
      <SaveActions
        paramsKey="lens=y&q=a&dash=u1&panel=5&dfrom=now-6h&dto=now"
        disabled={false}
        defaultTitle="x"
        buildPanel={buildPanel}
        timeRange={tr}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('Leave with unsaved changes?')).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/d/u1?from=now-6h&to=now'));
  });

  it('toolbar: a missing panel disables Save and return; Save as new and Share stay', async () => {
    api.getDashboard.mockResolvedValue({ dashboard: { panels: [] }, meta: {} });
    render(
      <SaveActions paramsKey="dash=u1&panel=5" disabled={false} defaultTitle="x" buildPanel={buildPanel} timeRange={tr} />
    );
    await waitFor(() => expect(api.getDashboard).toHaveBeenCalled());
    await act(async () => undefined);
    // Grafana renders a disabled button with a tooltip as aria-disabled (the tooltip says why).
    expect(screen.getByRole('button', { name: 'Save and return' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Save as new' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Share' })).toBeEnabled();
  });

  it('toolbar without a dashboard: one Save, and Share opens the share dialog', () => {
    render(<SaveActions paramsKey="lens=x" disabled={false} defaultTitle="x" buildPanel={buildPanel} timeRange={tr} />);
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save and return' })).toBeNull();
    expect(api.getDashboard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    expect(screen.getByText('Share this visualization')).toBeInTheDocument();
  });
});

describe('Add to dashboard (Discover)', () => {
  const renderModal = () => {
    window.history.replaceState({}, '', '/a/app/logs?q=error&from=now-1h&to=now&ds=v1');
    return render(
      <FieldsContext.Provider value={{ fields: [], loading: false } as never}>
        <AddToDashboardModal
          isOpen
          onDismiss={jest.fn()}
          config={config}
          queryState={{ ...DEFAULT_LOGS_QUERY_STATE, search: 'error', columns: defaultColumns(config) }}
          breakdown={{ kind: 'severity' } as never}
          caps={{ hasTime: true } as never}
          timeRange={tr}
        />
      </FieldsContext.Provider>
    );
  };

  it("titles the panels and opens the new dashboard on Discover's range", async () => {
    api.findDashboardsByTitle.mockResolvedValue([]);
    api.saveDashboard.mockResolvedValue({ uid: 'n', url: '/d/n/x' });
    renderModal();
    fireEvent.change(screen.getByLabelText('Logs table panel title'), { target: { value: 'Payment errors' } });
    fireEvent.change(screen.getByLabelText('Volume histogram panel title'), { target: { value: 'Errors over time' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
    });
    const [dash] = api.saveDashboard.mock.calls[0];
    expect(dash.time).toEqual({ from: '2026-01-05T08:00:00.000Z', to: '2026-01-05T12:00:00.000Z' });
    const panels = dash.panels as Array<{ title: string; targets: Array<Record<string, unknown>> }>;
    expect(panels.map((p) => p.title)).toEqual(['Payment errors', 'Errors over time']);
    expect(panels[0].targets[0].observeDiscover).toBe('q=error&ds=v1');
  });

  it('warns on a duplicate dashboard title and explains a name conflict', async () => {
    jest.useFakeTimers();
    try {
      api.findDashboardsByTitle.mockResolvedValue([{ uid: 'o', title: 'Discover export', url: '/d/o' }]);
      renderModal();
      await act(async () => {
        jest.advanceTimersByTime(400);
      });
      expect(screen.getByText(/A dashboard with this title already exists/)).toBeInTheDocument();
      api.saveDashboard.mockRejectedValue({ status: 412, data: { status: 'name-exists' } });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Add to dashboard' }));
      });
      expect(screen.getByText(/named "Discover export" already exists/)).toBeInTheDocument();
      expect(mockPush).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('Saved searches menu button', () => {
  it('reads as a menu ("Saved searches", secondary), with no tooltip over the menu', () => {
    render(
      <SavedSearchMenu queryState={DEFAULT_LOGS_QUERY_STATE} timeRange={tr} onLoad={jest.fn()} activeDataViewId="v1" />
    );
    const button = screen.getByRole('button', { name: /Saved searches/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: /Save current/ })).toBeVisible();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
