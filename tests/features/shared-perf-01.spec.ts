import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// SHARED-PERF-01 responsiveness and honesty cues (docs/spec/30-shared.md): loading bar, slow
// query chip with Cancel, sampling / approximation labels.

/** Hold every datasource query for `ms` before letting it through, so the page looks slow. */
async function slowQueries(page: Page, ms: number) {
  await page.route('**/api/ds/query**', async (route) => {
    await new Promise((r) => setTimeout(r, ms));
    await route.continue().catch(() => undefined);
  });
}

test('Discover shows the loading bar while queries run and hides it after', async ({ page }) => {
  await slowQueries(page, 1500);
  const logs = new LogsPage(page);
  await logs.open();
  await expect(page.getByTestId('query-progress-bar')).toBeVisible();
  await expect(page.getByTestId('query-progress-bar')).toHaveCount(0, { timeout: 30_000 });
});

test('a slow Discover query shows "Still running" and Cancel stops waiting', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await expect(page.getByTestId('query-progress-bar')).toHaveCount(0, { timeout: 30_000 });
  await slowQueries(page, 20_000);
  await page.getByRole('button', { name: 'Refresh', exact: true }).first().click();
  const chip = page.getByTestId('query-progress-slow');
  await expect(chip).toContainText('Still running', { timeout: 10_000 });
  await chip.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('query-progress-bar')).toHaveCount(0);
  await expect(page.getByTestId('query-progress-cancelled')).toContainText('Query cancelled');
  // The previous rows stay on screen; no error banner for a cancel.
  await expect(page.getByText('Query error:')).toHaveCount(0);
  await page.getByTestId('query-progress-cancelled').getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByTestId('query-progress-cancelled')).toHaveCount(0);
});

// The map keys popover's "sample records" caption is covered in jest (FieldKeysPopover.test.tsx).

test('Visualize: loading bar while the chart runs; unique count is labelled approximate', async ({ page }) => {
  await slowQueries(page, 1500);
  const lens = {
    chartType: 'metric',
    buckets: [],
    metrics: [{ kind: 'metric', id: 'm', op: 'unique', field: 'ServiceName' }],
  };
  const viz = new VisualizePage(page);
  await viz.open({ lens: JSON.stringify(lens) });
  await expect(page.getByTestId('query-progress-bar')).toBeVisible();
  await expect(page.getByTestId('lens-approx-note')).toContainText('approximate', { timeout: 30_000 });
  await expect(page.getByTestId('query-progress-bar')).toHaveCount(0);
});

test('Visualize: an exact metric has no approximation note', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  await expect(viz.chart).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('lens-approx-note')).toHaveCount(0);
});
