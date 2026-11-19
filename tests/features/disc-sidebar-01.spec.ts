import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// DISC-SIDEBAR-01 field list (docs/spec/10-discover.md): search, type filter, groups, Popular.

test('search field names and filter by type with counts', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const available = page.getByRole('region', { name: 'Available fields' });
  await expect(available.getByTitle('ServiceName', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Filter by field type' }).click();
  const numberCount = Number(
    await page.getByRole('group', { name: 'Filter by field type' }).locator('label', { hasText: 'Number' }).locator('span').last().textContent()
  );
  expect(numberCount).toBeGreaterThanOrEqual(2); // TraceFlags, SeverityNumber (+ numeric JSON paths)
  await page.getByRole('checkbox', { name: 'Number fields' }).check({ force: true });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Filter by field type (1 active)' })).toBeVisible();
  await expect(available.getByTitle('SeverityNumber', { exact: true })).toBeVisible();
  await expect(available.getByTitle('ServiceName', { exact: true })).toBeHidden();
  // Nothing selected or popular here, so Available lists exactly the Number fields.
  await expect(available.getByLabel(`${numberCount} fields`)).toBeVisible();

  await page.getByRole('textbox', { name: 'Search field names' }).fill('Trace');
  await expect(available.getByTitle('TraceFlags', { exact: true })).toBeVisible();
  await expect(available.getByTitle('SeverityNumber', { exact: true })).toBeHidden();
});

test('fields used from the list appear under Popular fields, remembered across reloads', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.evaluate(() => localStorage.removeItem('clickhouse-observe.fieldUsage'));
  await page.reload();
  await expect(page.getByRole('region', { name: 'Popular fields' })).toHaveCount(0);

  // Row actions show on hover.
  await page.getByRole('region', { name: 'Available fields' }).getByTitle('TraceId', { exact: true }).hover();
  await page.getByRole('button', { name: 'Add TraceId as column' }).click();
  const selected = page.getByRole('region', { name: 'Selected fields' });
  await expect(selected.getByTitle('TraceId', { exact: true })).toBeVisible();
  await selected.getByTitle('TraceId', { exact: true }).hover();
  await page.getByRole('button', { name: 'Remove TraceId column' }).click();

  const popular = page.getByRole('region', { name: 'Popular fields' });
  await expect(popular.getByTitle('TraceId', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'Popular fields' }).getByTitle('TraceId', { exact: true })).toBeVisible();
});

test('groups collapse and expand', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const header = page.getByRole('region', { name: 'Available fields' }).getByRole('button', { name: /Available fields/ });
  await expect(header).toHaveAttribute('aria-expanded', 'true');
  await header.click();
  await expect(header).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('region', { name: 'Available fields' }).getByTitle('ServiceName', { exact: true })).toBeHidden();
  await header.click();
  await expect(page.getByRole('region', { name: 'Available fields' }).getByTitle('ServiceName', { exact: true })).toBeVisible();
});
