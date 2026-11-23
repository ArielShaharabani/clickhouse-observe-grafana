import { addEditLinks, applyEditLinks, scanEditLinks } from '../editLinks';

const mockGet = jest.fn();
const mockPost = jest.fn();
jest.mock('@grafana/runtime', () => ({
  config: { namespace: 'default' },
  getBackendSrv: () => ({ get: mockGet, post: mockPost }),
}));

const ch = { type: 'grafana-clickhouse-datasource', uid: 'c' };
const chPanel = (id: number, extra = {}) => ({ id, type: 'table', title: `P${id}`, datasource: ch, targets: [{ refId: 'A' }], ...extra });
const urls = (p: unknown) => ((p as { links?: Array<{ url: string }> }).links ?? []).map((l) => l.url);

it('links ClickHouse panels only, in rows too, with their own id, and keeps user links', () => {
  const user = { title: 'Runbook', url: 'https://example.com' };
  const dash = {
    panels: [
      chPanel(1, { links: [user] }),
      { id: 2, type: 'row', panels: [chPanel(3, { datasource: undefined, targets: [{ refId: 'A', datasource: ch }] })] },
      { id: 4, type: 'table', datasource: { type: 'prometheus' }, targets: [{}] },
      { id: 5, type: 'text' },
      { id: 6, libraryPanel: { uid: 'x' } },
    ],
  };
  const { dashboard, changed } = addEditLinks(dash);
  expect(changed).toEqual(['P1', 'P3']);
  const [p1, row, p4, p5, p6] = dashboard.panels as Array<Record<string, unknown>>;
  expect(urls(p1)[0]).toBe(user.url);
  expect(urls(p1)[1]).toContain('&panel=1&');
  expect(urls((row.panels as unknown[])[0])[0]).toContain('&panel=3&');
  expect([urls(p4), urls(p5), urls(p6)]).toEqual([[], [], []]);
  // A second run changes nothing; a duplicate's copied link is corrected.
  expect(addEditLinks(dashboard).changed).toEqual([]);
  const dup = addEditLinks({ panels: [p1, { ...p1, id: 9, title: 'Copy' }] });
  expect(dup.changed).toEqual(['Copy']);
  expect(urls((dup.dashboard.panels as unknown[])[1])).toEqual([user.url, expect.stringContaining('&panel=9&')]);
});

describe('against the API', () => {
  let stored = 'v0alpha1';
  let meta: Record<string, unknown> = {};
  beforeEach(() => {
    stored = 'v0alpha1';
    meta = {};
    mockPost.mockReset().mockResolvedValue({ uid: 'd1', url: '/d/d1' });
    mockGet.mockReset().mockImplementation(async (url: string) => {
      if (url.startsWith('/api/search')) {
        return [
          { uid: 'd1', title: 'Dash', url: '' },
          { uid: 's1', title: 'Saved', url: '', tags: ['observe-saved-search'] },
        ];
      }
      if (url.startsWith('/apis/')) {
        return { status: { conversion: { storedVersion: stored } } };
      }
      return { dashboard: { uid: 'd1', title: 'Dash', version: 3, panels: [chPanel(1)] }, meta: { folderUid: 'f', ...meta } };
    });
  });

  it('a scan only reads, skips saved searches and says what it cannot change', async () => {
    expect(await scanEditLinks()).toEqual([{ uid: 'd1', title: 'Dash', folder: undefined, panels: ['P1'] }]);
    meta = { provisioned: true };
    expect((await scanEditLinks())[0].blocked).toMatch(/Provisioned/);
    meta = { canSave: false };
    expect((await scanEditLinks())[0].blocked).toMatch(/permission/);
    meta = {};
    stored = 'v2beta1';
    expect((await scanEditLinks())[0].blocked).toMatch(/layout/);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('applying saves with the version lock and the folder; a v2 dashboard is never written', async () => {
    expect(await applyEditLinks('d1')).toBe(1);
    const body = mockPost.mock.calls[0][1];
    expect(body).toMatchObject({ folderUid: 'f', overwrite: false, dashboard: { version: 3 } });
    expect(urls(body.dashboard.panels[0])).toHaveLength(1);
    mockPost.mockClear();
    stored = 'v2';
    await expect(applyEditLinks('d1')).rejects.toThrow(/v2/);
    expect(mockPost).not.toHaveBeenCalled();
  });
});
