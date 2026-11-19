import { readFileSync } from 'node:fs';
import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-INSPECT-01 Inspector (docs/spec/20-lens.md): Data view (table, sort, cell filters, CSV)
// and Requests view (statistics, request SQL, response).

async function openServicesChart(page: Page) {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await expect(viz.group('Horizontal axis')).toContainText('Top 9 values of ServiceName');
  await expect(viz.chart).toBeVisible();
  await page.getByRole('button', { name: 'Inspect' }).click();
  const drawer = page.getByRole('dialog', { name: /Inspector/ });
  await expect(drawer).toBeVisible();
  return { viz, drawer };
}

test('Data view: chart table, sortable headers, cell filter for', async ({ page }) => {
  const { drawer } = await openServicesChart(page);
  const table = drawer.getByRole('table', { name: 'Inspector data' });
  await expect(table.getByRole('row')).toHaveCount(1 + Object.keys(FIXTURE.counts.byService).length);
  await expect(table.getByRole('row', { name: /payments/ })).toContainText('9,264');

  // Ascending then descending by count: payments (the only service above 8,064) ends up first.
  const countHeader = table.getByRole('button', { name: /Count of records/ });
  await countHeader.click();
  await countHeader.click();
  await expect(table.getByRole('columnheader', { name: /Count of records/ })).toHaveAttribute(
    'aria-sort',
    'descending'
  );
  await expect(table.getByRole('row').nth(1)).toContainText('payments');

  await table.getByRole('row', { name: /payments/ }).hover();
  await drawer.getByRole('button', { name: /^Filter for .*: payments$/ }).click();
  await expect(page.getByRole('button', { name: /^Filter actions: .*payments/ })).toBeVisible();
  expect(new URL(page.url()).searchParams.get('filters')).toContain('payments');
  // The table follows the re-run chart: only payments is left.
  await expect(table.getByRole('row')).toHaveCount(2);
});

test('Data view: Download CSV raw', async ({ page }) => {
  const { drawer } = await openServicesChart(page);
  await drawer.getByRole('button', { name: /Download CSV/ }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Raw CSV/ }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/-raw-.*\.csv$/);
  const csv = readFileSync((await download.path())!, 'utf8');
  expect(csv.split('\r\n')[0]).toBe('Top 9 values of ServiceName,Count of records');
  expect(csv).toContain(`payments,${FIXTURE.counts.byService.payments}`);
});

test('Requests view: statistics, request SQL and response', async ({ page }) => {
  const { drawer } = await openServicesChart(page);
  await drawer.getByRole('radio', { name: 'Requests' }).click();
  await expect(drawer.getByText(/requests? (was|were) made/)).toBeVisible();
  const stats = drawer.getByRole('table', { name: 'Request statistics' });
  await expect(stats.getByRole('row', { name: /^Result rows 5$/ })).toBeVisible();
  await expect(stats.getByRole('row', { name: /^Table default\.spec_logs$/ })).toBeVisible();
  await expect(stats.getByRole('row', { name: /^Status ok$/ })).toBeVisible();
  await drawer.getByRole('tab', { name: 'Request' }).click();
  await expect(drawer.getByLabel('Inspector request')).toContainText('SELECT');
  await expect(drawer.getByLabel('Inspector request')).toContainText('ServiceName');
  await drawer.getByRole('tab', { name: 'Response' }).click();
  await expect(drawer.getByLabel('Inspector response')).toContainText('payments');
});
