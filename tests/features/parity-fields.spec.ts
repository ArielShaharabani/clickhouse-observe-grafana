import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// PARITY-FIELDS: Map keys as fields, empty / invalid states, filter groups + bulk menu, field
// statistics blank / time range, unknown KQL field (docs/dev/pending/PARITY-FIELDS.md).

test('Map keys appear as ordinary fields in the sidebar and the Add filter picker', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.searchInput.waitFor();
  await page.getByLabel('Search field names').fill('host.name');
  await expect(page.getByRole('button', { name: /^Preview ResourceAttributes\.host\.name/ })).toBeVisible();
  await page.getByRole('button', { name: 'Add a structured filter' }).or(page.getByText('Add filter')).first().click();
  await page.getByRole('combobox', { name: 'Field' }).fill('host');
  await expect(page.getByRole('option', { name: /^ResourceAttributes\.host\.name/ })).toBeVisible();
});

test('zero results show help and "Search entire time range" widens the range', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ from: 'now-1h', to: 'now' });
  await expect(page.getByTestId('no-results')).toBeVisible();
  await page.getByRole('button', { name: 'Search entire time range' }).click();
  await expect(page.getByTestId('no-results')).toHaveCount(0);
  await expect(logs.grid).toBeVisible();
});

test('an invalid query replaces the results with the error', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.searchInput.fill('ServiceName : (');
  await logs.searchInput.press('Enter');
  await expect(page.getByTestId('results-error')).toBeVisible();
  // Round 2 #2: the previous search's bars and count are not left above the error.
  await expect(page.getByTestId('histogram-invalid-query')).toBeVisible();
  await expect(page.getByText(/rows \(count\)/)).toHaveCount(0);
});

test('unknown KQL field shows a warning', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.searchInput.fill('nosuchfield : x');
  await logs.searchInput.press('Escape');
  await expect(page.getByTestId('kql-unknown-field')).toContainText('nosuchfield');
});

test('filter groups and the bulk menu', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({
    filters: JSON.stringify([
      { id: 'a', field: 'ServiceName', op: '=', value: 'auth' },
      { id: 'b', field: 'ServiceName', op: '=', value: 'checkout' },
    ]),
  });
  await page.getByRole('button', { name: /^Filter actions: ServiceName = auth/ }).click();
  await page.getByRole('menuitem', { name: /Group with next filter/ }).click();
  await expect(page.locator('[data-group-op="or"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'All filters actions' }).click();
  await page.getByRole('menuitem', { name: 'Remove all' }).click();
  await expect(page.getByTestId('filter-pills')).toHaveCount(0);
});

test('field statistics profile Timestamp as a range', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('radio', { name: 'Field statistics' }).click();
  const row = page.getByTestId('field-stats-row-Timestamp');
  await expect(row).toContainText('→');
});
