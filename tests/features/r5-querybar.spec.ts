import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { LogsPage } from '../pages/LogsPage';

// R5-QUERYBAR: one shared query bar (data view picker, Schema, Add filter, query menu, KQL bar) in
// Discover and Visualize; the Visualize toolbar no longer shows a "Visualize" title.

test('Discover: Schema button lists the columns with their types', async ({ page }) => {
  await new LogsPage(page).open({});
  await page.getByRole('button', { name: 'Show schema' }).click();
  const table = page.getByRole('table', { name: 'Schema columns' });
  await expect(table.getByRole('cell', { name: 'LogAttributes', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: /^Map\(/ }).first()).toBeVisible();
});

test('Visualize: same query bar, Schema button, no title', async ({ page }) => {
  await new VisualizePage(page).open({});
  const row = page.getByTestId('lens-query-row');
  await expect(row.getByRole('button', { name: 'Show schema' })).toBeVisible();
  await expect(row.getByRole('textbox', { name: 'Search logs (KQL)' })).toBeVisible();
  await expect(page.getByText('Visualize', { exact: true })).toHaveCount(0);
});
