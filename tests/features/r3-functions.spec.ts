import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-CALC-01 (docs/spec/20-lens.md): Standard deviation, Last value, Counter rate, Cumulative sum,
// Differences, Moving average and the formula's time-series / overall_* functions.

const editor = (page: Page) => page.getByRole('dialog', { name: /^Edit / });

const dateDim = { kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp', interval: '1d' };
const svcDim = { kind: 'terms', id: 'b1', field: 'ServiceName', label: 'ServiceName', size: 9 };
const lensOf = (chartType: string, buckets: object[], metrics: object[]) =>
  JSON.stringify({ chartType, buckets, metrics });

/** The SQL of the next Lens chart query (the request body carries rawSql). */
async function nextLensSql(page: Page, action: () => Promise<unknown>): Promise<string> {
  const req = page.waitForRequest(
    (r) => r.url().includes('/api/ds/query') && (r.postData() ?? '').includes('LIMIT 50001')
  );
  await action();
  return (await req).postData() ?? '';
}

test('Cumulative sum of Count of records ends at the fixture total', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: lensOf('table', [dateDim], [{ kind: 'metric', id: 'm0', op: 'cumulative_sum', ref: { op: 'count' } }]),
  });
  await expect(viz.dimensions).toContainText('Cumulative sum of Count of records');
  // The table is paginated (R5-VIZ-LAYOUT); the last bucket, which holds the total, is on the last page.
  await expect(viz.chart).toBeVisible();
  const next = viz.chart.getByRole('button', { name: 'next page' });
  if (await next.isEnabled().catch(() => false)) {
    await next.click();
  }
  await expect(
    viz.chart.getByText(FIXTURE.counts.total.toLocaleString('en-US'), { exact: true }).first()
  ).toBeVisible();
});

test('without a date histogram the Calculations are disabled with the reason', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lensOf('table', [svcDim], [{ kind: 'metric', id: 'm0', op: 'count' }]) });
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  const calcs = editor(page).getByRole('group', { name: 'Calculations' });
  await expect(calcs.getByRole('button', { name: 'Moving average' })).toBeDisabled();
  await expect(
    editor(page).getByText('Calculations need a date histogram dimension. Add one to use them.')
  ).toBeVisible();
  // The new statistics are plain functions and stay available.
  await expect(
    editor(page).getByRole('group', { name: 'Quick function' }).getByRole('button', { name: 'Standard deviation' })
  ).toBeEnabled();
});

test('Moving average wraps the current metric, in one windowed query', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lensOf('line', [dateDim], [{ kind: 'metric', id: 'm0', op: 'count' }]) });
  await expect(viz.chart).toBeVisible();
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  const sql = await nextLensSql(page, () =>
    editor(page).getByRole('group', { name: 'Calculations' }).getByRole('button', { name: 'Moving average' }).click()
  );
  expect(sql).toContain('OVER (ORDER BY __d ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING)');
  expect(sql).toContain('WITH FILL');
  await expect(editor(page).getByRole('note', { name: 'About this function' })).toContainText(
    'the current bucket is not included'
  );
  await expect(editor(page).getByLabel('Window size')).toHaveValue('5');
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viz.dimensions).toContainText('Moving average of Count of records');
});

test('a calculation that lost its date histogram shows why instead of a chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: lensOf('table', [svcDim], [{ kind: 'metric', id: 'm0', op: 'differences', ref: { op: 'count' } }]),
  });
  await expect(page.getByText('This chart needs a date histogram')).toBeVisible();
  await expect(page.getByText(/Differences of Count of records needs a date histogram dimension/)).toBeVisible();
});

test('formula percent of total: count() / overall_sum(count())', async ({ page }) => {
  const viz = new VisualizePage(page);
  const sql = await nextLensSql(page, () =>
    viz.open({
      lens: lensOf(
        'table',
        [svcDim],
        [{ kind: 'metric', id: 'm0', op: 'formula', formula: 'count() / overall_sum(count())', formulaFields: {} }]
      ),
    })
  );
  expect(sql).toContain('sum(a0) OVER ()');
  // payments 9,264 of 41,520 rows.
  await expect(viz.chart.getByText(/^0\.22/).first()).toBeVisible();
});

test('a tampered moving-average window in a shared link is clamped, never printed', async ({ page }) => {
  const viz = new VisualizePage(page);
  const sql = await nextLensSql(page, () =>
    viz.open({
      lens: lensOf(
        'line',
        [dateDim],
        [{ kind: 'metric', id: 'm0', op: 'moving_average', window: '5) FROM system.users --', ref: { op: 'count' } }]
      ),
    })
  );
  expect(sql).not.toContain('system.users');
  expect(sql).toContain('-5)');
});
