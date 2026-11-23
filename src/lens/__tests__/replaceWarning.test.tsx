import React from 'react';
import { dateTime } from '@grafana/data';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SaveActions } from '../SaveActions';
import { PanelImport } from '../panelImport';
import { getDashboard, saveDashboard, searchDashboards } from '../../data/dashboards';
import { editInVisualizePath, IMPORT_PARAM } from '../panelSource';

jest.mock('../../data/dashboards');
jest.mock('../../utils/permissions', () => ({ canCreateDashboards: () => true, canViewDashboards: () => true }));
const push = jest.fn();
HTMLCanvasElement.prototype.getContext = (() => ({ measureText: () => ({ width: 10 }) })) as never;
jest.mock('@grafana/runtime', () => ({
  ...jest.requireActual('@grafana/runtime'),
  locationService: { push: (p: string) => push(p) },
  getAppEvents: () => ({ publish: jest.fn() }),
}));

const dashboard = {
  title: 'Dash',
  version: 4,
  panels: [
    { id: 2, type: 'timeseries', title: 'Orig', gridPos: { x: 0, y: 0, w: 12, h: 8 }, links: [{ title: 'x' }] },
    { id: 5, type: 'text', title: 'Other', gridPos: { x: 12, y: 0, w: 12, h: 8 } },
  ],
};
const params = 'dash=abc&panel=2&from=now-1h&to=now&dfrom=now-1h&dto=now';
const base: PanelImport = { kind: 'ok', search: '', filters: [], notes: [], title: 'Orig', description: '', originalQuery: 'SELECT 1' };
const tr = { from: dateTime(0), to: dateTime(1000), raw: { from: 'now-1h', to: 'now' } };

function setup(imported?: PanelImport) {
  (getDashboard as jest.Mock).mockResolvedValue({ dashboard: JSON.parse(JSON.stringify(dashboard)), meta: {} });
  (saveDashboard as jest.Mock).mockResolvedValue({ uid: 'abc', url: '/d/abc' });
  (searchDashboards as jest.Mock).mockResolvedValue([]);
  const buildPanel = jest.fn((title: string) => ({
    id: 1,
    type: 'timeseries',
    title,
    gridPos: { x: 0, y: 0, w: 12, h: 8 },
    datasource: { type: 't', uid: 'u' },
    targets: [],
  }));
  render(
    <SaveActions
      paramsKey={params}
      disabled={false}
      defaultTitle="Chart"
      buildPanel={buildPanel as never}
      timeRange={tr}
      imported={imported}
      hasChart
    />
  );
  return buildPanel;
}
const saveAndReturn = () => screen.getByRole('button', { name: 'Save and return' });
const ready = async () => {
  await waitFor(() => expect(getDashboard).toHaveBeenCalled());
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};

describe('every replace of an original panel goes through the check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('a lossless panel is replaced in one click, no dialog', async () => {
    setup(base);
    await ready();
    fireEvent.click(saveAndReturn());
    await waitFor(() => expect(saveDashboard).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('Replace the original panel?')).toBeNull();
    expect((saveDashboard as jest.Mock).mock.calls[0][1]).toMatchObject({ overwrite: false });
  });

  it('no import info (a panel saved from Visualize) behaves as before', async () => {
    setup(undefined);
    await ready();
    fireEvent.click(saveAndReturn());
    await waitFor(() => expect(saveDashboard).toHaveBeenCalledTimes(1));
  });

  it.each([
    ['partial', { ...base, kind: 'partial' as const, notes: ['Field overrides (2)', 'Thresholds'] }, ['Field overrides (2)', 'Thresholds']],
    [
      'unsupported',
      { ...base, kind: 'unsupported' as const, reason: 'The panel has several queries', notes: ['x'] },
      ['The panel has several queries', 'The original query and the panel settings'],
    ],
  ])('%s: one click opens the warning and saves nothing', async (_n, imported, items) => {
    setup(imported);
    await ready();
    fireEvent.click(saveAndReturn());
    const dialog = await screen.findByRole('dialog', { name: 'Replace the original panel?' });
    for (const i of items) {
      expect(within(dialog).getByText(i)).toBeInTheDocument();
    }
    expect(within(dialog).getByRole('button', { name: 'Replace anyway' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Save as new panel' })).toBeInTheDocument();
    expect(saveDashboard).not.toHaveBeenCalled();
    // Cancel does nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Replace the original panel?' })).toBeNull());
    expect(saveDashboard).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it('Replace anyway replaces that panel only, with the version lock', async () => {
    setup({ ...base, kind: 'partial', notes: ['Thresholds'] });
    await ready();
    fireEvent.click(saveAndReturn());
    const dialog = await screen.findByRole('dialog', { name: 'Replace the original panel?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace anyway' }));
    await waitFor(() => expect(saveDashboard).toHaveBeenCalledTimes(1));
    const [saved, opts] = (saveDashboard as jest.Mock).mock.calls[0];
    expect(opts).toMatchObject({ overwrite: false });
    expect(saved.panels).toHaveLength(2);
    expect(saved.panels[0]).toMatchObject({ id: 2, gridPos: { x: 0, y: 0, w: 12, h: 8 } });
    expect(saved.panels[0].links).toBeUndefined(); // the loss the dialog listed
    expect(saved.panels[1]).toEqual(dashboard.panels[1]);
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringContaining('/d/abc')));
  });

  it('Save as new panel adds to the same dashboard and leaves the original untouched', async () => {
    setup({ ...base, kind: 'partial', notes: ['Thresholds'] });
    await ready();
    fireEvent.click(saveAndReturn());
    const dialog = await screen.findByRole('dialog', { name: 'Replace the original panel?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save as new panel' }));
    const save = await screen.findByRole('dialog', { name: 'Save Lens visualization' });
    expect(within(save).getByRole('radio', { name: 'Existing' })).toBeChecked();
    expect(saveDashboard).not.toHaveBeenCalled();
  });

  it('the dialog Save and return needs the confirm checkbox when lossy', async () => {
    (getDashboard as jest.Mock).mockResolvedValue({ dashboard: JSON.parse(JSON.stringify(dashboard)), meta: {} });
    (saveDashboard as jest.Mock).mockRejectedValueOnce({ status: 412, data: { status: 'version-mismatch' } });
    setup({ ...base, kind: 'partial', notes: ['Thresholds'] });
    await ready();
    fireEvent.click(saveAndReturn());
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Replace the original panel?' })).getByRole('button', { name: 'Replace anyway' }));
    // The failed save opens the dialog with the reason; replacing from there asks again.
    const save = await screen.findByRole('dialog', { name: 'Save Lens visualization' });
    const btn = within(save).getByRole('button', { name: 'Save and return' });
    expect(btn).toBeDisabled();
    fireEvent.click(within(save).getByRole('checkbox'));
    expect(btn).toBeEnabled();
  });

  it('Open panel is offered next to the save actions', async () => {
    setup(base);
    expect(screen.getByRole('button', { name: 'Open panel' })).toBeInTheDocument();
  });
});

describe('the panel menu link', () => {
  it('names only the dashboard and panel; no SQL travels', () => {
    const path = editInVisualizePath({
      targets: [{ refId: 'A', rawSql: 'SELECT secret' } as never],
      id: 7,
      dashboard: { uid: 'abc' },
      timeRange: { from: 'now-1h', to: 'now' },
    });
    const sp = new URLSearchParams(path?.split('?')[1]);
    expect([...sp.keys()].sort()).toEqual(['dash', 'dfrom', 'dto', 'from', 'panel', IMPORT_PARAM, 'to'].sort());
    expect(path).not.toMatch(/SELECT|lens/);
    expect(sp.get(IMPORT_PARAM)).toMatch(/^[a-z0-9]+$/);
  });
  it('needs a saved dashboard and a panel id', () => {
    expect(editInVisualizePath({ targets: [], id: 7 })).toBeUndefined();
    expect(editInVisualizePath({ targets: [], id: 7, dashboard: { uid: 'bad uid!' } })).toBeUndefined();
    expect(editInVisualizePath({ targets: [], id: 0, dashboard: { uid: 'abc' } })).toBeUndefined();
    expect(editInVisualizePath({ targets: [], dashboard: { uid: 'abc' } })).toBeUndefined();
  });
});
