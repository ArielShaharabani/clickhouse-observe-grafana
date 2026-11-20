import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-CHART-01 Table and Metric specifics (docs/spec/20-lens.md).
// Fixture: payments 9,264 records of which 1,575 are errors; auth 8,064 (FIXTURE.counts).

const editor = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const svc = { kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 };
const sev = { kind: 'terms', id: 'b1', field: 'SeverityText', label: 'SeverityText', size: 9 };
const count = { kind: 'metric', id: 'm0', op: 'count' };
const lens = (s: object) => JSON.stringify(s);

test('Table: Split metrics by turns severity values into columns, one row per service', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lens({ chartType: 'table', buckets: [svc, { ...sev, pivot: true }], metrics: [count] }) });
  await expect(viz.group('Rows')).toContainText('ServiceName');
  await expect(viz.group('Split metrics by')).toContainText('SeverityText');
  await expect(viz.chart.getByText('error › Count of records')).toBeVisible();
  await expect(viz.chart.getByText(FIXTURE.counts.errorsByService.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  // One row per service, not per (service, severity).
  await expect(viz.chart.getByText('payments', { exact: true })).toHaveCount(1);
});

test('Table: summary row and colour by value from the metric editor (no re-query)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lens({ chartType: 'table', buckets: [svc], metrics: [count] }) });
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  let queries = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/ds/query')) {
      queries++;
    }
  });
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page).getByRole('combobox', { name: 'Summary row' }).click();
  await page.getByRole('option', { name: 'Sum' }).click();
  await editor(page).getByRole('radio', { name: 'Cell' }).click();
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  // Footer: the sum of all services.
  await expect(viz.chart.getByText(FIXTURE.counts.total.toLocaleString('en-US'), { exact: true })).toBeVisible();
  const url = new URL(page.url()).searchParams.get('lens') ?? '';
  expect(url).toContain('"summary":"sum"');
  expect(url).toContain('"colorBy":"cell"');
  expect(queries).toBe(0);
});

test('Metric: one tile per service with a secondary metric and a progress bar against the maximum', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: lens({
      chartType: 'metric',
      buckets: [svc],
      metrics: [
        { ...count, filter: 'SeverityText : error', name: 'Errors' },
        { kind: 'metric', id: 'm1', op: 'unique', field: 'SeverityText', name: 'Levels' },
        { kind: 'metric', id: 'm2', op: 'count', role: 'max', name: 'All' },
      ],
    }),
  });
  await expect(viz.chart).toHaveAttribute('data-panel', 'tiles');
  await expect(viz.group('Maximum value')).toContainText('All');
  const tile = viz.chart.getByRole('listitem', { name: /^payments:/ });
  await expect(tile).toContainText('1,575');
  await expect(tile).toContainText('Levels');
  // 1,575 / 9,264 ≈ 17 %.
  await expect(tile.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '17');
});

test('Metric: adding to Maximum value keeps the primary metric; switching to Bar drops the role', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lens({ chartType: 'metric', buckets: [], metrics: [count] }) });
  await viz.dimensions.getByRole('button', { name: 'Add to Maximum value' }).click();
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viz.group('Primary metric')).toContainText('Count of records');
  await expect(viz.group('Maximum value')).toContainText('Count of records');
  await expect(viz.chart.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');

  await page.getByRole('button', { name: 'Chart type: Metric' }).click();
  await page.getByRole('option', { name: /^Bar/ }).click();
  expect(new URL(page.url()).searchParams.get('lens') ?? '').not.toContain('"role"');
});

test('a hostile summary / colour / role in a shared link is dropped', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: lens({
      chartType: 'table',
      buckets: [{ ...svc, pivot: '1; DROP TABLE x' }],
      metrics: [{ ...count, summary: "sum') FROM system.users --", colorBy: '<img>', role: 'admin' }],
    }),
  });
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  await expect(viz.group('Rows')).toContainText('ServiceName');
  await expect(viz.group('Split metrics by')).not.toContainText('ServiceName');
});
