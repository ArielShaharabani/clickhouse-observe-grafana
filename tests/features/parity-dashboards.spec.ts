import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// PARITY-DASHBOARDS (Kibana 9.5 comparison): Save and return, Discover → dashboard time range and
// columns, Open in Discover, Add to dashboard dialog, legend names, Share in Visualize, short
// links, Saved searches button. Dashboards use unique titles (tests share one Grafana).

test.describe.configure({ timeout: 120_000 });

const unique = (name: string) => `${name} ${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function panelMenu(page: Page, title: string, item: string) {
  const header = page.getByTestId(/data-testid Panel header/).filter({ hasText: title });
  await expect(header).toBeVisible();
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: 'Extensions' }).hover();
  await page.getByRole('menuitem', { name: item }).click();
}

/** A dashboard with a text panel and one Visualize panel (errors by service), saved from Visualize. */
async function dashboardWithVisualizePanel(page: Page) {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('ServiceName');
  const title = unique('Errors by service');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();
  await expect(page).toHaveURL(/\/d\//);
  const uid = new URL(page.url()).pathname.split('/')[2];
  return { uid, title };
}

test('Edit in Visualize → Save and return replaces the panel in place and keeps the dashboard time', async ({
  page,
}) => {
  const { uid, title } = await dashboardWithVisualizePanel(page);
  const before = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  const original = before.dashboard.panels[0];

  // Open the dashboard on a specific range, then Edit in Visualize.
  await page.goto(`/d/${uid}?from=${FIXTURE.incident.from}&to=${FIXTURE.incident.to}`);
  await panelMenu(page, title, 'Edit in Visualize');
  await expect(page).toHaveURL(/\/visualize\?/);
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('dash')).toBe(uid);
  expect(sp.get('panel')).toBe(String(original.id));

  // Kibana's toolbar: Cancel / Save as new / Save and return.
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save as new' })).toBeVisible();
  await page.getByRole('button', { name: /^Chart type: / }).click();
  await page.getByRole('option', { name: /^Line/ }).click();
  await page.getByRole('button', { name: 'Save and return' }).click(); // one click, no dialog

  // Grafana may rewrite the epoch range to ISO strings, so accept either form.
  await expect(page).toHaveURL(
    new RegExp(`/d/${uid}.*from=(${FIXTURE.incident.from}|${new Date(FIXTURE.incident.from).toISOString().replace(/[:.]/g, (c) => (c === '.' ? '\.' : '(:|%3A)'))})`)
  );
  const after = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(after.dashboard.panels).toHaveLength(before.dashboard.panels.length); // no duplicate
  expect(after.dashboard.panels[0]).toMatchObject({ id: original.id, gridPos: original.gridPos, title }); // the panel's own title
  expect(after.dashboard.panels[0].type).toBe('timeseries');
});

test('Edit in Visualize → Cancel goes back to the dashboard unchanged', async ({ page }) => {
  const { uid, title } = await dashboardWithVisualizePanel(page);
  const before = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  await page.goto(`/d/${uid}?from=now-30d&to=now`);
  await panelMenu(page, title, 'Edit in Visualize');
  await page.getByRole('button', { name: 'Cancel' }).click(); // nothing changed: no prompt
  await expect(page).toHaveURL(new RegExp(`/d/${uid}.*from=now-30d`));
  const after = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(after.dashboard.version).toBe(before.dashboard.version);
});

test('Edit in Visualize → Cancel after a change asks before discarding', async ({ page }) => {
  const { uid, title } = await dashboardWithVisualizePanel(page);
  const before = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  await page.goto(`/d/${uid}?from=now-30d&to=now`);
  await panelMenu(page, title, 'Edit in Visualize');
  await expect(page.getByRole('button', { name: 'Save and return' })).toBeEnabled();
  await page.getByRole('button', { name: /^Chart type: / }).click();
  await page.getByRole('option', { name: /^Line/ }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  const confirm = page.getByRole('dialog', { name: 'Leave with unsaved changes?' });
  await confirm.getByRole('button', { name: 'Cancel' }).click(); // stay
  await expect(page).toHaveURL(/\/visualize\?/);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await confirm.getByRole('button', { name: 'Discard changes' }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${uid}.*from=now-30d`));
  const after = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(after.dashboard.version).toBe(before.dashboard.version);
});

test('Save and return reports a concurrent change instead of overwriting it', async ({ page }) => {
  const { uid, title } = await dashboardWithVisualizePanel(page);
  await page.goto(`/d/${uid}`);
  await panelMenu(page, title, 'Edit in Visualize');
  await expect(page.getByRole('button', { name: 'Save and return' })).toBeEnabled();
  // Someone else saves the dashboard meanwhile.
  const current = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  await page.request.post('/api/dashboards/db', {
    data: { dashboard: { ...current.dashboard, title: unique('Renamed') }, overwrite: true },
  });
  await page.getByRole('button', { name: 'Save and return' }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await expect(dialog.getByText(/Someone else changed this dashboard/)).toBeVisible();
  await expect(page).toHaveURL(/\/visualize\?/);
});

test("Discover → Add to dashboard: Discover's range, titled panels, Discover's columns, Open in Discover", async ({
  page,
}) => {
  const logs = new LogsPage(page);
  await logs.open({
    q: 'SeverityText:error',
    from: String(FIXTURE.incident.from),
    to: String(FIXTURE.incident.to),
  });
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to dashboard' });
  const dashTitle = unique('Discover export');
  await dialog.getByLabel('Logs table panel title').fill('Incident errors');
  await dialog.getByLabel('Volume histogram panel title').fill('Incident volume');
  await dialog.getByRole('textbox', { name: /Dashboard title/ }).fill(dashTitle);
  await dialog.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(page).toHaveURL(/\/d\//);
  const uid = new URL(page.url()).pathname.split('/')[2];

  const saved = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  // The dashboard opens on Discover's range, not "Last 1 hour" (the panels showed No data).
  expect(new Date(saved.dashboard.time.from).getTime()).toBe(FIXTURE.incident.from);
  expect(new Date(saved.dashboard.time.to).getTime()).toBe(FIXTURE.incident.to);
  const [table, volume] = saved.dashboard.panels;
  expect([table.title, volume.title]).toEqual(['Incident errors', 'Incident volume']);
  const organize = table.transformations[0].options;
  const order = Object.entries(organize.indexByName as Record<string, number>)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => organize.renameByName[k]);
  expect(order.slice(0, 4)).toEqual(['Time', 'Level', 'Service', 'Message']);
  expect(table.targets[0].observeDiscover).toContain('q=SeverityText');

  // Both panels have data; the table shows Discover's columns and a row count.
  const tablePanel = page.getByTestId(/data-testid Panel header/).filter({ hasText: 'Incident errors' });
  await expect(page.getByText('No data')).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Message' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'TimestampTime' })).toHaveCount(0);
  await expect(tablePanel).toBeVisible();

  // Open in Discover restores the search and the dashboard's time.
  await panelMenu(page, 'Incident errors', 'Open in Discover');
  await expect(page).toHaveURL(/\/logs\?/);
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('q')).toBe('SeverityText:error');
  expect(sp.get('ds')).toBe(FIXTURE.dataViewId);
  await expect(logs.searchInput).toHaveValue('SeverityText:error');
});

test('Add to dashboard: a duplicate dashboard title is flagged and refused with a clear message', async ({
  page,
}) => {
  const dashTitle = unique('Duplicate target');
  const created = await page.request.post('/api/dashboards/db', {
    data: { dashboard: { title: dashTitle, panels: [], schemaVersion: 39 }, overwrite: false },
  });
  expect(created.ok()).toBeTruthy();
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: 'Add to dashboard' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add to dashboard' });
  await dialog.getByRole('textbox', { name: /Dashboard title/ }).fill(dashTitle);
  await expect(dialog.getByText(/A dashboard with this title already exists/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Add to dashboard' }).click();
  await expect(dialog.getByText(/already exists in this folder/)).toBeVisible();
  // Checkbox labels sit next to their boxes.
  const box = await dialog.getByText('Logs table', { exact: true }).boundingBox();
  const input = await dialog.getByLabel('Logs table panel title').boundingBox();
  expect(box!.x + box!.width).toBeLessThan(input!.x);
});

test('Visualize panels: split series are named by value (no "m0 " prefix)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('Timestamp');
  await viz.addField('ServiceName');
  await page.getByRole('button', { name: /^Chart type: / }).click();
  await page.getByRole('option', { name: /^Line/ }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  const title = unique('Errors over time');
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();
  await expect(page).toHaveURL(/\/d\//);
  const uid = new URL(page.url()).pathname.split('/')[2];
  const saved = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  expect(saved.dashboard.panels[0].targets[0].rawSql).toContain('WITH FILL');
  const panel = page.getByTestId(/data-testid Panel header/).filter({ hasText: title }).locator('..');
  await expect(panel.getByText('payments', { exact: true })).toBeVisible();
  await expect(panel.getByText(/^m0 /)).toHaveCount(0);
});

test('Visualize Share: short link that reopens the chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('ServiceName');
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Share this visualization' });
  const link = modal.getByLabel('Share link');
  await expect(link).toHaveValue(/\/goto\/[A-Za-z0-9_-]+/);
  await page.goto(await link.inputValue());
  await expect(page).toHaveURL(/\/visualize\?/);
  await expect(viz.dimensions).toContainText('ServiceName');
  expect(new URL(page.url()).searchParams.get('q')).toBe('SeverityText:error');
});

test('Discover: the Saved searches menu button reads as a menu and its tooltip does not cover it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const button = page.getByRole('button', { name: /^Saved searches/ });
  await expect(button).toBeVisible();
  await button.hover();
  await button.click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.getByRole('button', { name: /Save current/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
});
