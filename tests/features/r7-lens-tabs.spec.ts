import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import pluginJson from '../../src/plugin.json';

// R7 Visualize session tabs (storage key clickhouse-observe.lensTabs).

const tabs = (page: Page) => page.getByRole('tablist', { name: 'Visualize tabs' });
const tab = (page: Page, name: string | RegExp) => tabs(page).getByRole('tab', { name });
const unique = (name: string) => `${name} ${Date.now().toString(36)}`;

test('Visualize has a tab strip; a link opens in a new tab when the active tab has a chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await expect(tabs(page)).toBeVisible();
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
  await viz.addField('ServiceName');
  await expect(viz.dimensions).toContainText('ServiceName');

  // A link (a shared chart, Edit in Visualize) never replaces the chart.
  await viz.open({ q: 'ServiceName:auth' });
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();

  // The first tab still has its chart.
  await tabs(page).getByRole('tab').first().click();
  await expect(viz.dimensions).toContainText('ServiceName');
});

test('a link opens in the active tab while it is empty', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.open({ q: 'ServiceName:auth' });
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
});

test('the side-menu entry reopens the active tab when it has a chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'ServiceName:payments' });
  await viz.addField('SeverityText');
  await expect(viz.dimensions).toContainText('SeverityText');

  await page.goto(`/a/${pluginJson.id}/visualize`);
  await expect(viz.dimensions).toContainText('SeverityText');
  expect(new URL(page.url()).searchParams.get('q')).toBe('ServiceName:payments');
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
});

test('the side-menu entry on a chart-less tab does not bring back the old search', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'ServiceName:auth' });
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
  await page.goto(`/a/${pluginJson.id}/visualize`);
  await expect(tabs(page)).toBeVisible();
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
});

test('add, rename and close a tab; the closed one is listed under Recently closed', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(tabs(page).getByRole('tab')).toHaveCount(2);

  await tabs(page).getByRole('tab').first().dblclick();
  const input = page.getByRole('textbox', { name: 'Tab name' });
  await input.fill('Mine');
  await input.press('Enter');
  await expect(tab(page, 'Mine')).toBeVisible();

  await page.getByRole('button', { name: 'Close tab: Mine' }).click();
  await expect(tabs(page).getByRole('tab')).toHaveCount(1);
  await page.getByRole('button', { name: 'All tabs' }).click();
  await expect(page.getByRole('menuitem', { name: /Mine/ })).toBeVisible();
});

test('Cancel from a dashboard panel closes its tab into Recently closed; the tab is named after the panel', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('ServiceName');
  const title = unique('Tabbed panel');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Save Lens visualization' });
  await dialog.getByLabel(/^Title/).fill(title);
  await dialog.getByRole('radio', { name: 'New' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Save and go to dashboard' }).click();
  await expect(page).toHaveURL(/\/d\//);

  const header = page.getByTestId(/data-testid Panel header/).filter({ hasText: title });
  await header.hover();
  await header.getByRole('button', { name: /menu/i }).click();
  await page.getByRole('menuitem', { name: 'Extensions' }).hover();
  await page.getByRole('menuitem', { name: 'Edit in Visualize' }).click();
  await expect(page).toHaveURL(/\/visualize\?/);
  await expect(page.getByRole('button', { name: 'Save and return' })).toBeVisible();
  // The tab is named after the opened panel.
  await expect(tab(page, new RegExp(title))).toBeVisible();

  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const confirm = page.getByRole('button', { name: /Discard|Leave|Yes/ });
  if (await confirm.first().isVisible().catch(() => false)) {
    await confirm.first().click();
  }
  await expect(page).toHaveURL(/\/d\//);

  // Back in Visualize (side-menu entry): the panel's tab is under Recently closed.
  await page.goto(`/a/${pluginJson.id}/visualize`);
  await expect(tabs(page)).toBeVisible();
  await expect(tab(page, new RegExp(title))).toHaveCount(0);
  await page.getByRole('button', { name: 'All tabs' }).click();
  await expect(page.getByRole('menuitem', { name: new RegExp(title) })).toBeVisible();
});
