import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

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

// R2-SAVED (docs/dev/pending/R2-SAVED.md): saved search rough edges and folder.
test('saved search: tab title, ss URL param, folder, store-time checkbox, delete name', async ({ page, request }) => {
  const name = `R2 saved ${Date.now()}`;
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: /Saved searches/ }).click();
  await page.getByRole('button', { name: 'Save current' }).click();
  await page.getByLabel('Search name').fill(name);
  const storeTime = page.getByRole('checkbox', { name: 'Store time range' });
  await expect(storeTime).toBeChecked();
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // The saved search is the open one: id in the URL, title on the tab.
  await expect.poll(() => new URL(page.url()).searchParams.get('ss')).toMatch(/^ss_\d+_[a-z0-9]+$/);
  await expect(page.getByRole('tab', { name })).toBeVisible();
  const ss = new URL(page.url()).searchParams.get('ss')!;

  // Stored in the "Observe saved searches" folder when Grafana lets the user create it.
  const hits = await (await request.get(`/api/search?query=${ss}&type=dash-db`)).json();
  expect(hits[0]?.folderTitle).toBe('Observe saved searches');

  // A fresh page with only the id reopens the saved search.
  await page.goto(`/a/poortuna-clickhouse-observe-app/logs?ss=${ss}`);
  await expect(page.getByRole('tab', { name })).toBeVisible();

  // Changing the query drops the id (after the saved search has finished loading, or its load
  // would replace the typed query).
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.searchInput.fill('zzz-changed');
  await logs.searchInput.press('Enter');
  await logs.expectRowCount(0);
  await expect.poll(() => new URL(page.url()).searchParams.has('ss')).toBe(false);

  // The delete button has an accessible name.
  await page.getByRole('button', { name: /Saved searches/ }).click();
  await page.getByRole('button', { name: `Delete saved search ${name}` }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
});
