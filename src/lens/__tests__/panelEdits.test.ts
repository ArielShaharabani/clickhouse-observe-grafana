import { appendPanelsToDashboard, ExportedPanel, replacePanelInDashboard } from '../../data/panelExport';
import {
  chartEdited,
  editInVisualizePath,
  isEditLink,
  panelEdits,
  panelSignature,
  VISUALIZE_SIG_KEY,
  withEditLink,
  withoutEditLink,
} from '../panelSource';

const target = { refId: 'A', rawSql: 'SELECT 1', observeVisualize: 'lens=%7B%7D&ds=v1' };
const plain = { type: 'barchart', targets: [target], fieldConfig: { defaults: {}, overrides: [] }, transformations: [] };
const signed = { ...plain, targets: [{ ...target, [VISUALIZE_SIG_KEY]: panelSignature(plain) }] };

it('ignores what Grafana itself adds on a save, and key order', () => {
  expect(panelEdits(signed)).toEqual([]);
  expect(
    panelEdits({
      ...signed,
      title: 'x',
      pluginVersion: '13',
      options: { a: 1 },
      fieldConfig: { defaults: { color: {} }, overrides: [] },
      targets: [{ ...signed.targets[0], meta: {}, queryType: 'table' }],
    })
  ).toEqual([]);
  expect(panelEdits({ ...signed, transformations: undefined })).toEqual([]);
});

it('tells query, type, override and transformation edits apart', () => {
  const q = panelEdits({ ...signed, targets: [{ ...signed.targets[0], rawSql: 'SELECT 2' }] });
  expect(q).toHaveLength(1);
  expect(chartEdited(q)).toBe(true);
  expect(chartEdited(panelEdits({ ...signed, type: 'timeseries' }))).toBe(true);
  const o = panelEdits({ ...signed, fieldConfig: { defaults: {}, overrides: [{ a: 1 }] } });
  expect(o).toHaveLength(1);
  expect(chartEdited(o)).toBe(false);
  expect(panelEdits(plain)).toEqual([]);
});

it('the panel menu reads the dashboard panel once the query was edited', () => {
  const ctx = { pluginId: 'barchart', id: 3, dashboard: { uid: 'abc' } };
  const path = (targets: unknown) => editInVisualizePath({ ...ctx, targets } as Parameters<typeof editInVisualizePath>[0]);
  expect(path(signed.targets)).toContain('lens=');
  const edited = path([{ ...signed.targets[0], rawSql: 'SELECT 2' }]);
  expect(edited).not.toContain('lens=');
  expect(edited).toContain('pi=');
});

it('adds one link with the panel id, keeps the user links, and leaves other panels alone', () => {
  const user = { title: 'Runbook', url: 'https://example.com' };
  const once = withEditLink({ ...signed, links: [user] as unknown[] }, 4);
  const twice = withEditLink(once, 5);
  expect(twice.links).toHaveLength(2);
  expect(twice.links.filter(isEditLink)).toHaveLength(1);
  expect((twice.links[1] as { url: string }).url).toContain('&panel=5&');
  expect(withoutEditLink(twice).links).toEqual([user]);
  const other = { targets: [{ refId: 'A' }] };
  expect(withEditLink(other, 1)).toBe(other);
});

it('append and replace write the id the panel gets', () => {
  const panel = { ...signed, id: 1, title: 't', gridPos: { x: 0, y: 0, w: 1, h: 1 } } as unknown as ExportedPanel;
  const url = (d: Record<string, unknown>, i: number) => ((d.panels as ExportedPanel[])[i].links as Array<{ url: string }>)[0].url;
  const dash = { panels: [{ id: 7, gridPos: { x: 0, y: 0, w: 1, h: 1 } }] };
  expect(url(appendPanelsToDashboard(dash, [panel]), 1)).toContain('&panel=8&');
  expect(url(replacePanelInDashboard(dash, 7, panel), 0)).toContain('&panel=7&');
});
