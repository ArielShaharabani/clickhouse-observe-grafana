import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// R3-QUERYBAR: Visualize has Discover's query row (Add filter, query menu, KQL bar, filter pills)
// over the shared URL context (docs/spec/20-lens.md). Counts come from the deterministic fixture.

const bar = (page: import('@playwright/test').Page) => page.getByRole('textbox', { name: 'Search logs (KQL)' });

test('open from Discover with a query, edit it, the chart updates, Explore in Discover carries it back', async ({
  page,
}) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments' });
  await page.getByRole('link', { name: 'Explore in Visualize' }).click();
  const viz = new VisualizePage(page);
  await expect(bar(page)).toHaveValue('ServiceName:payments');
  // Explore in Visualize opens a chart over time; start from top values of ServiceName instead.
  await viz.open({ q: 'ServiceName:payments' });
  await expect(bar(page)).toHaveValue('ServiceName:payments');
  await viz.addField('ServiceName');
  await expect(viz.chart.getByRole('button', { name: /^payments · Count of records: 9,264$/ })).toBeVisible();

  // Typing alone changes nothing.
  await bar(page).fill('ServiceName:auth');
  expect(new URL(page.url()).searchParams.get('q')).toBe('ServiceName:payments');
  await bar(page).press('Enter');
  await expect(viz.chart.getByRole('button', { name: /^auth · Count of records: 8,064$/ })).toBeVisible();
  await expect(viz.chart.getByRole('button', { name: /^payments · / })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('q')).toBe('ServiceName:auth');

  // Back returns to the previous query.
  await page.goBack();
  await expect(bar(page)).toHaveValue('ServiceName:payments');

  await page.goForward();
  const href = await page.getByRole('link', { name: 'Explore in Discover' }).getAttribute('href');
  expect(new URLSearchParams(href!.split('?')[1]).get('q')).toBe('ServiceName:auth');
  await page.getByRole('link', { name: 'Explore in Discover' }).click();
  await expect(logs.searchInput).toHaveValue('ServiceName:auth');
});

test('an invalid query shows the error and no chart; fixing it brings the chart back', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await expect(viz.chart).toBeVisible();
  await bar(page).fill('ServiceName:(auth');
  await bar(page).press('Enter');
  await expect(page.getByTestId('lens-invalid-query')).toBeVisible();
  await expect(viz.chart).toHaveCount(0);
  await bar(page).fill('ServiceName:auth');
  await bar(page).press('Enter');
  await expect(page.getByTestId('lens-invalid-query')).toHaveCount(0);
  await expect(viz.chart.getByRole('button', { name: /^auth · Count of records: 8,064$/ })).toBeVisible();
});

test('Add filter on Visualize adds a pill and re-runs; Clear all in the query menu removes query and filters', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'SeverityText:error' });
  await viz.addField('ServiceName');
  await page.getByRole('button', { name: 'Add filter' }).click();
  await page.getByRole('combobox', { name: 'Field' }).click();
  await page.getByRole('option', { name: /^ServiceName( |$)/ }).first().click();
  await page.getByRole('combobox', { name: 'Operator' }).click();
  await page.getByRole('option', { name: /^is( |$)/ }).first().click();
  const value = page.getByRole('combobox', { name: 'Value', exact: true });
  await value.click();
  await value.fill('payments');
  await expect(page.getByRole('option').first()).toBeVisible();
  await value.press('Enter');
  await page.getByRole('button', { name: 'Add filter', exact: true }).last().click();
  await expect(page.getByTestId('filter-pills').getByRole('button', { name: /^Filter actions: ServiceName/ })).toBeVisible();
  await expect(viz.chart.getByRole('button', { name: new RegExp(`^payments · Count of records: ${FIXTURE.counts.paymentsErrors.toLocaleString('en-US')}$`) })).toBeVisible();

  await page.getByRole('button', { name: 'Query menu' }).click();
  await page.getByText('Clear all', { exact: true }).click();
  await expect(bar(page)).toHaveValue('');
  await expect(page.getByTestId('filter-pills').getByRole('button', { name: /^Filter actions:/ })).toHaveCount(0);
});
