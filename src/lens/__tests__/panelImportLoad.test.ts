import { assertClassicDashboard, listDashboardPanels, loadDashboardPanel, V2_MESSAGE, withLibraryModel } from '../panelImportLoad';
import { getDashboard, getLibraryPanelModel } from '../../data/dashboards';

jest.mock('../../data/dashboards');

const dash = {
  title: 'D',
  time: { from: 'now-6h', to: 'now' },
  panels: [
    { id: 1, type: 'timeseries', title: 'A' },
    { id: 2, type: 'row', title: 'Row', collapsed: true, panels: [{ id: 3, type: 'stat', title: 'In row' }, { id: 4, type: 'text' }] },
    { id: 5, libraryPanel: { uid: 'lib1', name: 'L' }, title: 'Lib' },
    { type: 'text', title: 'no id' },
    null,
  ],
};

describe('listDashboardPanels', () => {
  it('lists panels incl. those in rows, with type and row; skips rows and id-less panels', () => {
    const l = listDashboardPanels(dash as never);
    expect(l.map((p) => [p.id, p.type, p.row])).toEqual([
      [1, 'timeseries', undefined],
      [3, 'stat', 'Row'],
      [4, 'text', 'Row'],
      [5, 'library panel', undefined],
    ]);
    expect(l[2].title).toBe('Panel 4');
  });
  it('v2 schema dashboards give a clear message', () => {
    expect(() => assertClassicDashboard({ apiVersion: 'dashboard.grafana.app/v2beta1', spec: {} })).toThrow(V2_MESSAGE);
    expect(() => assertClassicDashboard({ elements: {} })).toThrow(V2_MESSAGE);
    expect(() => listDashboardPanels({ elements: { a: {} } })).toThrow(V2_MESSAGE);
    expect(() => assertClassicDashboard(dash as never)).not.toThrow();
  });
});

describe('loading', () => {
  it('finds a panel inside a collapsed row and reads the dashboard time', async () => {
    (getDashboard as jest.Mock).mockResolvedValue({ dashboard: dash, meta: { folderUid: 'f' } });
    const lp = await loadDashboardPanel('abc', 3);
    expect(lp.panel.title).toBe('In row');
    expect([lp.from, lp.to]).toEqual(['now-6h', 'now']);
    expect(lp.folderUid).toBe('f');
  });
  it('a removed panel is reported', async () => {
    (getDashboard as jest.Mock).mockResolvedValue({ dashboard: dash, meta: {} });
    await expect(loadDashboardPanel('abc', 99)).rejects.toThrow(/no longer on the dashboard/);
  });
  it('a library panel reference gets its model, keeping the reference', async () => {
    (getLibraryPanelModel as jest.Mock).mockResolvedValue({ type: 'stat', targets: [{ refId: 'A' }], title: 'model title' });
    const p = await withLibraryModel({ id: 5, libraryPanel: { uid: 'lib1', name: 'L' }, title: 'Lib', gridPos: { x: 0, y: 0, w: 1, h: 1 } });
    expect(p).toMatchObject({ id: 5, type: 'stat', title: 'Lib', libraryPanel: { uid: 'lib1' } });
    // A panel that already has targets is left alone.
    const full = { id: 1, libraryPanel: { uid: 'x' }, targets: [] };
    expect(await withLibraryModel(full)).toBe(full);
  });
});
