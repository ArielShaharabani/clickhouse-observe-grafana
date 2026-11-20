import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// PARITY-MINORS (docs/dev/pending/PARITY-MINORS.md): shared saved searches, Copy column.

test('save dialog has description and tags; the search is listed afterwards', async ({ page }) => {
  // Unique name: saved searches are shared state and survive earlier runs.
  const name = `Parity minors ${Date.now()}`;
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: /Saved searches/ }).click();
  await page.getByRole('button', { name: 'Save current' }).click();
  await page.getByLabel('Search name').fill(name);
  await page.getByLabel('Search description').fill('shared one');
  await page.getByLabel('Search tags').fill('a, b');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: /Saved searches/ }).click();
  await expect(page.getByText(name)).toBeVisible();
  await expect(page.getByText('#a #b').first()).toBeVisible();
});

test('column header menu has Copy column', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.grid.getByRole('button', { name: /^Level/ }).click();
  await expect(page.getByRole('menuitem', { name: 'Copy column' })).toBeVisible();
});
