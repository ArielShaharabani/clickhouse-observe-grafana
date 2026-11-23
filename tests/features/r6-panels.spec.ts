import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { FIXTURE } from '../fixture';

// R6-PANELS: "Edit in Visualize" on any dashboard panel (raw SQL timeseries, table, complex SQL,
// text, a panel with settings Visualize cannot carry) and "Open panel". One dashboard made through
// the API; deleted afterwards. Opening a panel never changes the dashboard.

test.describe.configure({ timeout: 180_000, mode: 'serial' });

const ds = { type: 'grafana-clickhouse-datasource', uid: 'clickhouse-dev' };
const T = 'Timestamp';
const sql = (rawSql: string) => [{ refId: 'A', datasource: ds, editorType: 'sql', format: 1, rawSql }];
const stamp = Date.now().toString(36);
const UID = `r6pn${stamp}`.slice(0, 40);
const names = {
  ts: `R6 raw timeseries ${stamp}`,
  table: `R6 raw table ${stamp}`,
  complex: `R6 complex ${stamp}`,
  text: `R6 text ${stamp}`,
  partial: `R6 partial ${stamp}`,
  inRow: `R6 in row ${stamp}`,
};
const pos = (x: number, y: number) => ({ x, y, w: 12, h: 4 });

const dashboard = {
  uid: UID,
  title: `R6 panels ${stamp}`,
  schemaVersion: 39,
  time: { from: new Date(FIXTURE.from).toISOString(), to: new Date(FIXTURE.to).toISOString() },
  panels: [
    {
      id: 1,
      type: 'timeseries',
      title: names.ts,
      gridPos: pos(0, 0),
      datasource: ds,
      targets: sql(
        `SELECT $__timeInterval(${T}) AS time, count() AS c FROM default.spec_logs WHERE $__timeFilter(${T}) GROUP BY time ORDER BY time`
      ),
      fieldConfig: { defaults: {}, overrides: [] },
      options: {},
    },
    {
      id: 2,
      type: 'table',
      title: names.table,
      gridPos: pos(12, 0),
      datasource: ds,
      targets: sql(
        `SELECT ServiceName, count() AS n FROM default.spec_logs WHERE $__timeFilter(${T}) AND SeverityText = 'error' GROUP BY ServiceName ORDER BY n DESC LIMIT 5`
      ),
      fieldConfig: { defaults: {}, overrides: [] },
      options: {},
    },
    {
      id: 3,
      type: 'table',
      title: names.complex,
      gridPos: pos(0, 4),
      datasource: ds,
      targets: sql(
        `SELECT a.ServiceName, count() AS n FROM default.spec_logs a INNER JOIN default.spec_logs b ON a.TraceId = b.TraceId WHERE $__timeFilter(a.${T}) GROUP BY a.ServiceName`
      ),
      fieldConfig: { defaults: {}, overrides: [] },
      options: {},
    },
    { id: 4, type: 'text', title: names.text, gridPos: pos(12, 4), options: { mode: 'markdown', content: 'hello' } },
    {
      id: 5,
      type: 'timeseries',
      title: names.partial,
      gridPos: pos(0, 8),
      datasource: ds,
      targets: sql(
        `SELECT $__timeInterval(${T}) AS time, count() AS c FROM default.spec_logs WHERE $__timeFilter(${T}) GROUP BY time ORDER BY time`
      ),
      links: [{ title: 'Runbook', url: 'https://example.com/runbook' }],
      fieldConfig: { defaults: {}, overrides: [] },
      options: {},
    },
    { id: 6, type: 'row', title: 'Collapsed row', collapsed: true, gridPos: { x: 0, y: 12, w: 24, h: 1 }, panels: [
      {
        id: 7,
        type: 'stat',
        title: names.inRow,
        gridPos: pos(0, 13),
        datasource: ds,
        targets: sql(`SELECT count() AS total FROM default.spec_logs WHERE $__timeFilter(${T})`),
        fieldConfig: { defaults: {}, overrides: [] },
        options: {},
      },
    ] },
  ],
};

type Dash = { dashboard: { version: number; panels: Array<Record<string, any>> } };
const get = async (page: Page): Promise<Dash> => (await page.request.get(`/api/dashboards/uid/${UID}`)).json();
const versionsCount = async (page: Page): Promise<number> => {
  const res = await page.request.get(`/api/dashboards/uid/${UID}/versions`);
  const body = await res.json();
  return (Array.isArray(body) ? body : (body.versions ?? [])).length;
};
const allPanels = (d: Dash) => d.dashboard.panels.flatMap((p) => [p, ...(p.panels ?? [])]);
const panel = (d: Dash, id: number) => allPanels(d).find((p) => p.id === id)!;

async function panelMenu(page: Page, title: string, item: string) {
  const header = page.getByTestId(/data-testid Panel header/).filter({ hasText: title });
  await expect(header).toBeVisible();
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: 'Extensions' }).hover();
  await page.getByRole('menuitem', { name: item }).click();
}
async function editInVisualize(page: Page, title: string) {
  await page.goto(`/d/${UID}`);
  await panelMenu(page, title, 'Edit in Visualize');
  await expect(page).toHaveURL(/\/visualize\?/);
}
const saveAndReturn = (page: Page) => page.getByRole('button', { name: 'Save and return' });

test('setup: create the dashboard through the API', async ({ page }) => {
  const res = await page.request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  expect(res.ok()).toBeTruthy();
});

test('the menu link is on every panel and carries no SQL', async ({ page }) => {
  await editInVisualize(page, names.ts);
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('dash')).toBe(UID);
  expect(sp.get('panel')).toBe('1');
  expect(page.url()).not.toMatch(/SELECT|rawSql/i);
});

test('raw-SQL timeseries: converted and drawn, Save and return replaces only that panel in one click', async ({ page }) => {
  const before = await get(page);
  await editInVisualize(page, names.ts);
  await expect(page.getByTestId('lens-chart')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Chart type: Line/ })).toBeVisible();
  await expect(page.getByTestId('panel-import-note')).toHaveCount(0); // fully converted: just opened
  // Opening never changes the dashboard.
  expect((await get(page)).dashboard.version).toBe(before.dashboard.version);
  await expect(saveAndReturn(page)).toBeEnabled();
  await saveAndReturn(page).click(); // lossless: no dialog
  await expect(page).toHaveURL(new RegExp(`/d/${UID}`));
  const after = await get(page);
  expect(after.dashboard.panels).toHaveLength(before.dashboard.panels.length);
  expect(panel(after, 1)).toMatchObject({ id: 1, title: names.ts, gridPos: pos(0, 0) });
  expect(panel(after, 1).targets[0].observeVisualize).toBeTruthy();
  for (const id of [2, 3, 4, 5, 6]) {
    expect(panel(after, id)).toEqual(panel(before, id));
  }
  expect(panel(after, 7)).toEqual(panel(before, 7));
});

test('raw-SQL table: converted to a Table with the same rows', async ({ page }) => {
  const before = await get(page);
  await editInVisualize(page, names.table);
  await expect(page.getByRole('button', { name: /^Chart type: Table/ })).toBeVisible();
  await expect(page.getByTestId('lens-chart')).toContainText('payments');
  await page.screenshot({ path: 'test-results/r6-table.png' });
  await expect(page.getByRole('button', { name: 'Filter actions: SeverityText = error' })).toBeVisible();
  expect((await get(page)).dashboard.version).toBe(before.dashboard.version);
  await page.screenshot({ path: 'test-results/r6-table.png' });
});

test('complex SQL: no chart, reason and original query shown; replacing asks first', async ({ page }) => {
  const before = await get(page);
  await editInVisualize(page, names.complex);
  const note = page.getByTestId('panel-import-note');
  await expect(note).toContainText(/join is not supported/i);
  await note.getByRole('button', { name: 'View original query' }).click();
  const q = page.getByRole('dialog', { name: 'Original query' });
  await expect(q).toContainText('INNER JOIN');
  await q.locator('button', { hasText: 'Close' }).click();
  await page.screenshot({ path: 'test-results/r6-complex.png' });
  // An empty chart cannot be saved.
  await expect(saveAndReturn(page)).toBeDisabled();
  await page.getByRole('region', { name: 'Fields' }).getByRole('textbox', { name: 'Search field names' }).fill('ServiceName');
  await page.getByRole('button', { name: 'Add ServiceName to workspace' }).click();
  await expect(saveAndReturn(page)).toBeEnabled();
  await saveAndReturn(page).click();
  const warn = page.getByRole('dialog', { name: 'Replace the original panel?' });
  await expect(warn).toContainText('The original query and the panel settings');
  await page.screenshot({ path: 'test-results/r6-warning.png' });
  await warn.getByRole('button', { name: 'Cancel' }).click();
  expect((await get(page)).dashboard.version).toBe(before.dashboard.version);

  // Save as new panel: added to the same dashboard, the original stays.
  await saveAndReturn(page).click();
  await warn.getByRole('button', { name: 'Save as new panel' }).click();
  const save = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await expect(save.getByRole('radio', { name: 'Existing' })).toBeChecked();
  await save.getByLabel(/^Title/).fill(`R6 new panel ${stamp}`);
  await expect(save.getByRole('button', { name: 'Save and go to dashboard' })).toBeEnabled();
  await save.getByRole('button', { name: 'Save and go to dashboard' }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${UID}`));
  const after = await get(page);
  expect(after.dashboard.panels.length).toBe(before.dashboard.panels.length + 1);
  expect(panel(after, 3)).toEqual(panel(before, 3));
});

test('text panel: opens without a chart and the reason; nothing can be saved', async ({ page }) => {
  const before = await get(page);
  await editInVisualize(page, names.text);
  await expect(page.getByTestId('panel-import-note')).toContainText(/Panel type "text" is not supported/);
  await expect(saveAndReturn(page)).toBeDisabled();
  expect((await get(page)).dashboard.version).toBe(before.dashboard.version);
});

test('panel with settings Visualize cannot carry: warning lists them; Replace anyway uses the version lock', async ({ page }) => {
  const before = await get(page);
  await editInVisualize(page, names.partial);
  await expect(page.getByTestId('panel-import-note')).toContainText(/could not be carried over/);
  await expect(saveAndReturn(page)).toBeEnabled();
  await saveAndReturn(page).click();
  const warn = page.getByRole('dialog', { name: 'Replace the original panel?' });
  await expect(warn).toContainText('Panel setting "links"');
  // The dashboard moves on meanwhile: Replace anyway must refuse, not overwrite.
  const cur = await get(page);
  await page.request.post('/api/dashboards/db', {
    data: { dashboard: { ...(cur.dashboard as object), title: `${dashboard.title} (renamed)` }, overwrite: true },
  });
  await warn.getByRole('button', { name: 'Replace anyway' }).click();
  await expect(page.getByRole('dialog', { name: 'Save Lens visualization' })).toContainText(/Someone else changed this dashboard/);
  expect(panel(await get(page), 5).links).toBeTruthy(); // not replaced
  await page.getByRole('dialog', { name: 'Save Lens visualization' }).getByRole('button', { name: 'Cancel' }).click();

  // Reload the panel and replace for real.
  const v0 = await versionsCount(page);
  await editInVisualize(page, names.partial);
  await expect(saveAndReturn(page)).toBeEnabled();
  await saveAndReturn(page).click();
  await warn.getByRole('button', { name: 'Replace anyway' }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${UID}`));
  const after = await get(page);
  expect(panel(after, 5).links).toBeUndefined();
  expect(panel(after, 5).targets[0].observeVisualize).toBeTruthy();
  // The replaced version stays in Grafana's version history (the warning says so).
  expect(await versionsCount(page)).toBeGreaterThan(v0);
  expect(before.dashboard.version).toBeLessThan(after.dashboard.version);
});

test('Open panel: dashboard + panel picker (rows, types, cannot-convert reasons), same import', async ({ page }) => {
  const before = await get(page);
  // Grafana indexes a new dashboard for search a moment after it is saved.
  await expect
    .poll(
      async () => {
        const hits = await (await page.request.get('/api/search?type=dash-db&limit=5000')).json();
        return (hits as Array<{ uid: string }>).some((h) => h.uid === UID);
      },
      { timeout: 60_000 }
    )
    .toBe(true);
  await page.goto('/a/poortuna-clickhouse-observe-app/visualize');
  await page.getByRole('button', { name: 'Open panel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Open panel' });
  // Type the name: a long list only renders the options in view.
  await dialog.getByRole('combobox').fill(dashboard.title);
  await page.getByRole('option', { name: new RegExp(dashboard.title) }).first().click();
  await expect(dialog.getByRole('radio', { name: `${names.text} (text)` })).toBeVisible();
  await expect(dialog.getByText(/Can't be converted: Panel type "text" is not supported/)).toBeVisible();
  await expect(dialog.getByText(/Can't be converted: The query can't be converted: A join is not supported/)).toBeVisible();
  await page.screenshot({ path: 'test-results/r6-open-panel.png' });
  // A panel inside a collapsed row opens too.
  await dialog.getByRole('radio', { name: `${names.inRow} (stat)` }).check({ force: true });
  await dialog.getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL(/\/visualize\?/);
  await expect(page.getByRole('button', { name: /^Chart type: Metric/ })).toBeVisible();
  await expect(page.getByTestId('lens-chart')).toBeVisible();
  expect((await get(page)).dashboard.version).toBeGreaterThanOrEqual(before.dashboard.version);
  expect((await get(page)).dashboard.version).toBe(before.dashboard.version);
});

test.afterAll(async ({ playwright }) => {
  const base = process.env.GRAFANA_URL || 'http://localhost:3000';
  const ctx = await playwright.request.newContext({ baseURL: base, httpCredentials: { username: 'admin', password: 'admin' } });
  await ctx.delete(`/api/dashboards/uid/${UID}`);
  await ctx.dispose();
});
