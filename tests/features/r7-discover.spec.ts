import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// R7 Discover: (1) the document panel keeps the fields sidebar and pushes the grid on wide pages;
// (2) a click on a grid cell opens the Expand popover.

const fields = (page: import('@playwright/test').Page) =>
  page.getByRole('textbox', { name: 'Search field names', exact: true });

test('wide page: opening a document keeps the fields sidebar and squeezes the grid', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const logs = new LogsPage(page);
  await logs.open();
  await expect(fields(page)).toBeVisible();
  const before = (await logs.grid.boundingBox())!;
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  const detail = page.getByRole('region', { name: 'Document detail' });
  await expect(detail).toBeVisible();
  await expect(fields(page)).toBeVisible();
  await expect(page.getByTitle('Show fields')).toHaveCount(0);
  await expect.poll(async () => (await logs.grid.boundingBox())!.width).toBeLessThan(before.width - 200);
  // Side by side: the panel does not cover the grid.
  const g = (await logs.grid.boundingBox())!;
  const d = (await detail.boundingBox())!;
  expect(g.x + g.width).toBeLessThanOrEqual(d.x + 2);
});

test('narrow page: the document panel goes over the grid; the sidebar stays', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 });
  const logs = new LogsPage(page);
  await logs.open();
  const before = (await logs.grid.boundingBox())!;
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByRole('region', { name: 'Document detail' })).toBeVisible();
  await expect(fields(page)).toBeVisible();
  const after = (await logs.grid.boundingBox())!;
  expect(after.width).toBeGreaterThanOrEqual(before.width - 2);
});

test('wide page: Expanded overlays the grid instead of squeezing it', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 900 });
  const logs = new LogsPage(page);
  await logs.open();
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByRole('region', { name: 'Document detail' })).toBeVisible();
  await page.getByRole('region', { name: 'Document detail' }).getByRole('button', { name: 'Expand', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Document detail' }).getByRole('button', { name: 'Shrink', exact: true })).toBeVisible();
  await expect(fields(page)).toBeVisible();
  const detail = (await page.getByRole('region', { name: 'Document detail' }).boundingBox())!;
  const g = (await logs.grid.boundingBox())!;
  expect(detail.width).toBeGreaterThan(700);
  expect(g.x + g.width).toBeGreaterThan(detail.x + 100); // over the grid, not beside it
});

test('left click on a cell opens the Expand popover; a second click closes it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const cell = logs.grid.locator('td[data-cell="0:1"]');
  await expect(cell).toBeVisible();
  const dialog = page.getByRole('dialog', { name: /^Value of / });
  await cell.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toBeVisible();
  await cell.click({ position: { x: 4, y: 4 } });
  await expect(dialog).toHaveCount(0);
});

test('clicking another cell moves the popover; Escape closes it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.grid.locator('td[data-cell="0:1"]').click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog', { name: /^Value of / })).toHaveCount(1);
  await logs.grid.locator('td[data-cell="8:0"]').click({ position: { x: 4, y: 4 } });
  await expect(page.getByRole('dialog', { name: /^Value of / })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /^Value of / })).toHaveCount(0);
});

test('a cut-off cell shows "Click to expand" on hover', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  // The Body column is cut off by the line clamp / ellipsis.
  const cells = logs.grid.locator('tbody td[data-cell]');
  await expect(cells.first()).toBeVisible();
  const n = await cells.count();
  let found = false;
  for (let i = 0; i < Math.min(n, 40) && !found; i++) {
    const c = cells.nth(i);
    await c.hover();
    found = await page.getByTestId('cell-expand-hint').isVisible();
  }
  expect(found).toBe(true);
  await expect(page.getByTestId('cell-expand-hint')).toContainText('Click to expand');
});

test('selecting text in a cell does not expand it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const cell = logs.grid.locator('td[data-cell="0:1"]');
  await cell.dblclick(); // selects a word
  await expect(page.getByRole('dialog', { name: /^Value of / })).toHaveCount(0);
});
