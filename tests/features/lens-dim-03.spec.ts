import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-DIM-03 Formula editor (docs/spec/20-lens.md). Fixture errors per service:
// payments 1,575, checkout 445 (FIXTURE.counts.errorsByService).

const editor = (page: Page) => page.getByRole('dialog', { name: /^Edit / });
const formulaBox = (page: Page) => editor(page).getByRole('textbox', { name: 'Formula' });

const byService = (metric: object) =>
  JSON.stringify({
    chartType: 'table',
    buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
    metrics: [metric],
  });

test('a formula from the URL runs: errors per service via count(kql=…)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: byService({
      kind: 'metric',
      id: 'm0',
      op: 'formula',
      formula: "count(kql='SeverityText : error')",
      formulaFields: {},
    }),
  });
  await expect(viz.chart.getByText(String(FIXTURE.counts.errorsByService.payments), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(String(FIXTURE.counts.errorsByService.checkout), { exact: true })).toBeVisible();
});

test('switching a metric to Formula converts it, and an edited formula re-runs the chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: byService({ kind: 'metric', id: 'm0', op: 'count' }) });
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page).getByRole('radio', { name: 'Formula' }).check({ force: true });
  await expect(formulaBox(page)).toHaveValue('count()');

  await formulaBox(page).fill("count(kql='SeverityText : error') * 2");
  await formulaBox(page).blur();
  await expect(viz.chart.getByText(String(2 * FIXTURE.counts.errorsByService.payments), { exact: true })).toBeVisible();
  // The formula rides in the URL: a reload keeps it.
  await expect(page).toHaveURL(/formula/);
  await page.reload();
  await expect(viz.chart.getByText(String(2 * FIXTURE.counts.errorsByService.payments), { exact: true })).toBeVisible();
});

test('autocomplete lists functions with signatures; errors show a badge and are not applied', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: byService({ kind: 'metric', id: 'm0', op: 'count' }) });
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page).getByRole('radio', { name: 'Formula' }).check({ force: true });

  await formulaBox(page).fill('');
  await formulaBox(page).pressSequentially('cou');
  await expect(editor(page).getByRole('option').first()).toContainText('count([field: field]?, [kql=string]?)');
  await formulaBox(page).press('Enter');
  await expect(formulaBox(page)).toHaveValue('count()');

  await formulaBox(page).fill('sum(SeverityText)');
  await expect(editor(page).getByRole('status')).toHaveText('⚠ 1 error');
  await formulaBox(page).blur();
  // Still the last valid formula (count()).
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
});

test('a shared link whose formula names a field outside the data view is dropped (no SQL from the URL)', async ({
  page,
}) => {
  const viz = new VisualizePage(page);
  const queries: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/ds/query')) {
      queries.push(r.postData() ?? '');
    }
  });
  await viz.open({
    lens: JSON.stringify({
      chartType: 'table',
      buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
      metrics: [
        { kind: 'metric', id: 'm0', op: 'count' },
        {
          kind: 'metric',
          id: 'm1',
          op: 'formula',
          formula: 'sum(x)',
          formulaFields: { x: { expr: '(SELECT 1)', numeric: true } },
        },
      ],
    }),
  });
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
  await expect(viz.dimensions).not.toContainText('sum(x)');
  expect(queries.some((q) => q.includes('SELECT 1'))).toBe(false);
});
