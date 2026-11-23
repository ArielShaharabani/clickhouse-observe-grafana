import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// Round 7: a Visualize panel edited in Grafana's own editor can still be edited in Visualize. Grafana
// hides the panel menu's Extensions while the dashboard is in edit mode; the panel's link stays.

test.describe.configure({ timeout: 150_000 });

const made: string[] = [];
test.afterAll(async ({ request }) => {
  for (const uid of made) {
    await request.delete(`/api/dashboards/uid/${uid}`);
  }
});

async function saveNew(page: Page, field: string): Promise<{ uid: string; title: string }> {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField(field);
  const title = `R7 edit ${Date.now().toString(36)}`;
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();
  await page.waitForURL(/\/d\//);
  const uid = new URL(page.url()).pathname.split('/')[2];
  made.push(uid);
  return { uid, title };
}

async function panelOf(page: Page, uid: string) {
  const j = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  return j.dashboard.panels[0];
}

/** Opens Grafana's panel editor from the menu, runs `edit`, saves, goes back (still in edit mode). */
async function editInGrafana(page: Page, edit: () => Promise<void>) {
  const header = page.getByTestId(/data-testid Panel header/).first();
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: /^Edit/ }).first().click();
  await expect(page.getByRole('button', { name: 'Back to dashboard' })).toBeVisible();
  await edit();
  await page.getByRole('button', { name: /^Save/ }).first().click();
  await page.getByTestId(/Save dashboard drawer/i).last().click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Back to dashboard' }).click();
}

const link = (page: Page) => page.getByRole('link', { name: 'Edit in Visualize' }).or(page.locator('a[href*="pi=link"]')).first();

test('after a title edit: the link shows in edit mode, opens the chart, Save and return does not warn', async ({ page }) => {
  const { uid, title } = await saveNew(page, 'ServiceName');
  await editInGrafana(page, async () => {
    const box = page.getByTestId('data-testid Panel editor option pane field input Title');
    await box.fill(`${title} renamed`);
    await box.blur();
  });
  await link(page).click();
  await expect(page).toHaveURL(/\/visualize\?/);
  const viz = new VisualizePage(page);
  await expect(viz.dimensions).toContainText('ServiceName');
  await expect(viz.chart).toBeVisible();
  await expect(page.getByTestId('panel-import-note')).toHaveCount(0);
  await page.getByRole('button', { name: 'Save and return' }).click();
  await expect(page).toHaveURL(new RegExp(`/d/${uid}`));
  const p = await panelOf(page, uid);
  expect(p.title).toBe(`${title} renamed`);
  expect(p.links.filter((l: { title: string }) => l.title === 'Edit in Visualize')).toHaveLength(1);
});

test('after a query edit Visualize opens the panel and Save and return warns first', async ({ page }) => {
  const { uid } = await saveNew(page, 'ServiceName');
  const sql = (await panelOf(page, uid)).targets[0].rawSql as string;
  await editInGrafana(page, async () => {
    await page.locator('.monaco-editor').first().click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(' -- by hand');
    await page.getByRole('button', { name: /Run Query/i }).first().click();
    await page.waitForTimeout(1000);
  });
  expect((await panelOf(page, uid)).targets[0].rawSql).not.toBe(sql);
  await link(page).click();
  const viz = new VisualizePage(page);
  await expect(viz.dimensions).toContainText('ServiceName');
  await expect(page.getByTestId('panel-import-note')).toBeVisible();
  await page.getByRole('button', { name: 'Save and return' }).click();
  await expect(page.getByRole('list', { name: 'What will be lost' })).toContainText(/query as it was edited/i);

  // The panel menu (outside edit mode) lands on the same chart and warning.
  await page.goto(`/d/${uid}`);
  const header = page.getByTestId(/data-testid Panel header/).first();
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: 'Extensions' }).hover();
  await page.getByRole('menuitem', { name: 'Edit in Visualize' }).click();
  await expect(viz.dimensions).toContainText('ServiceName');
  await expect(page.getByTestId('panel-import-note')).toBeVisible();
});

test('the link of a duplicated panel does not guess which one to edit', async ({ page }) => {
  const { uid } = await saveNew(page, 'ServiceName');
  const { dashboard } = await (await page.request.get(`/api/dashboards/uid/${uid}`)).json();
  dashboard.panels.push({ ...dashboard.panels[0], id: 2, gridPos: { x: 12, y: 0, w: 12, h: 8 } });
  await page.request.post('/api/dashboards/db', { data: { dashboard, overwrite: true } });
  await page.goto(`/d/${uid}`);
  await link(page).click();
  await expect(page.getByTestId('panel-import-error')).toContainText('duplicated');
});
