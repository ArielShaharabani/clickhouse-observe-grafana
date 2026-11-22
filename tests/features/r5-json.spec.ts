import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// R5-JSON (round 5 #10, #7): the JSON column `Payload` (`JSON(user.id UInt32)`, every fixture row
// `{"user":{"id":0}}`) through Discover and Visualize, and the Map / JSON field labels.

test('sidebar labels JSON paths and Map keys, and shows the ClickHouse type on hover', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const available = page.getByRole('region', { name: 'Available fields' });
  await page.getByRole('textbox', { name: 'Search field names' }).fill('Payload');
  const jsonRow = available.getByTitle('Payload.user.id', { exact: true });
  await expect(jsonRow).toBeVisible();
  await expect(jsonRow.locator('.field-item-source')).toHaveText('JSON');
  await expect(jsonRow.getByRole('button', { name: 'Preview Payload.user.id: number' })).toHaveAttribute(
    'title',
    'Payload.user.id\nPath in JSON column Payload\nClickHouse type: UInt32'
  );

  await page.getByRole('textbox', { name: 'Search field names' }).fill('http.method');
  const mapRow = available.getByTitle("LogAttributes['http.method']", { exact: true });
  await expect(mapRow.locator('.field-item-source')).toHaveText('Map');
  await expect(mapRow.getByRole('button', { name: /^Preview LogAttributes\.http\.method/ })).toHaveAttribute(
    'title',
    /Key of Map column LogAttributes\nClickHouse type: String/
  );
});

test('KQL autocomplete drills into the JSON column and suggests a path value', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.searchInput.click();
  await logs.searchInput.pressSequentially('Payl', { delay: 40 });
  const options = logs.searchBar.getByRole('listbox').getByRole('option');
  const container = options.filter({ hasText: 'json · browse paths' }).first();
  await expect(container).toBeVisible();
  await container.click();
  await expect(logs.searchInput).toHaveValue('Payload.');
  const path = options.filter({ hasText: 'Payload.user.id' }).first();
  await expect(path).toBeVisible();
  await path.click();
  await expect(logs.searchInput).toHaveValue('Payload.user.id ');
  await logs.searchInput.pressSequentially(': ', { delay: 40 });
  await expect(options.filter({ hasText: /0/ }).first()).toBeVisible();
});

test('queries on a JSON path filter rows; a value on the whole column matches nothing without an error', async ({
  page,
}) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'Payload.user.id : 0' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.open({ q: 'Payload.user.id >= 1' });
  await logs.expectRowCount(0);
  await logs.open({ q: 'Payload.user.id : 1*' });
  await logs.expectRowCount(0);
  await logs.open({ q: 'Payload : x' });
  await logs.expectRowCount(0);
  await expect(page.getByText(/Cannot parse JSON/)).toHaveCount(0);
  await logs.open({ q: 'Payload:*' });
  await logs.expectRowCount(FIXTURE.counts.total);
});

test('the full document shows the JSON path, with its type', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  const row = page.getByTestId('doc-field-row').filter({ has: page.getByTitle('Payload.user.id', { exact: true }) });
  await expect(row).toBeVisible();
  await expect(row).toContainText('0');
  await expect(page.getByText(/Field discovery failed/)).toHaveCount(0);
});

test('Visualize charts a JSON path and labels it in the field list', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.fields.getByRole('textbox', { name: 'Search field names' }).fill('Payload');
  await expect(viz.fields.getByText('JSON', { exact: true }).first()).toBeVisible();
  await expect(viz.fields.getByTitle(/ClickHouse type: UInt32/)).toBeVisible();
  await viz.fields.getByRole('textbox', { name: 'Search field names' }).fill('');
  await viz.addField('Payload.user.id');
  await expect(viz.dimensions).toContainText('Payload.user.id');
  await expect(viz.chart).toBeVisible();
  await expect(page.getByText(/Illegal type|DB::Exception/)).toHaveCount(0);
});
