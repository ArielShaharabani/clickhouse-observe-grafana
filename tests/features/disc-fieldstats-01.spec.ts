import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-FIELDSTATS-01 Field statistics tab (docs/spec/10-discover.md).
// Numbers: the 5,000 most recent fixture rows, same sample as the field popover (docs/dev/TESTING.md).

async function openStatsTab(page: Page) {
  await page.getByRole('radio', { name: 'Field statistics' }).click();
  await expect(page.getByTestId('field-stats-tab')).toBeVisible();
}

const row = (page: Page, name: string) => page.getByTestId(`field-stats-row-${name}`);

test('table: documents %, distinct values and mini distributions per field', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await openStatsTab(page);
  await expect(page.getByRole('grid')).toHaveCount(0); // documents grid replaced by the stats table
  const sev = row(page, 'SeverityText');
  await expect(sev).toContainText('5,000 (100%)');
  await expect(sev).toContainText('4 categories');
  await expect(row(page, 'SeverityNumber').getByLabel('SeverityNumber distribution from 5 to 17')).toBeVisible();
  await expect(page.getByText(/Calculated from 5,000 sample records/)).toBeVisible();

  await page.getByLabel('Show distributions').click({ force: true });
  await expect(sev).not.toContainText('4 categories');
});

test('expanded row: summary, top values, distribution; filter for a value (IT-A producer)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openStatsTab(page);
  await page.getByRole('button', { name: 'Expand SeverityNumber' }).click();
  const panel = page.getByTestId('field-stats-expanded-SeverityNumber');
  await expect(panel).toContainText('median');
  await expect(panel).toContainText('3,483 (69.7%)');
  await expect(panel.getByLabel(/: 3483 records$/)).toBeVisible();

  await page.getByRole('button', { name: 'Expand SeverityText' }).click();
  await page.getByRole('button', { name: 'Filter for SeverityText: error' }).click();
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);
  // Stats re-profile under the new filter (IT-A consumer): only errors left.
  await expect(row(page, 'SeverityText')).toContainText('1 category');
});

test('stats reflect the current filters (IT-A consumer)', async ({ page }) => {
  const payments = { id: 'e2e-payments', field: 'ServiceName', op: '=', value: 'payments' };
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([payments]) });
  await openStatsTab(page);
  await expect(row(page, 'ServiceName')).toContainText('1 category');
  await page.getByRole('button', { name: 'Expand SeverityText' }).click();
  await expect(page.getByTestId('field-stats-expanded-SeverityText')).toContainText('(27.4%)');
});

test('name filter narrows the list', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openStatsTab(page);
  await page.getByLabel('Filter fields by name').fill('severity');
  await expect(row(page, 'SeverityText')).toBeVisible();
  await expect(row(page, 'ServiceName')).toHaveCount(0);
});

test('IT-G: Visualize from the stats tab opens the field chart', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments' });
  await openStatsTab(page);
  await row(page, 'SeverityText').getByRole('button', { name: 'Visualize SeverityText' }).click();
  await expect(page).toHaveURL(/\/visualize\?/);
  expect(new URL(page.url()).searchParams.get('q')).toBe('ServiceName:payments');
});

test('switching back to Documents shows the grid again', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openStatsTab(page);
  await page.getByRole('radio', { name: 'Documents' }).click();
  await expect(logs.grid).toBeVisible();
  await logs.expectRowCount(FIXTURE.counts.total);
});
