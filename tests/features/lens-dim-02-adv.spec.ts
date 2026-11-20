import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// PLAN 16g — metric dimension Advanced / Appearance options (docs/spec/20-lens.md LENS-DIM-02).
// Fixture errors per service: payments 1,575, checkout 445 (FIXTURE.counts.errorsByService).

const editor = (page: Page) => page.getByRole('dialog', { name: /^Edit / });

const byService = (metric: object, chartType = 'table') =>
  JSON.stringify({
    chartType,
    buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
    metrics: [metric],
  });

/** The SQL of the next Lens chart query (the request body carries rawSql). */
async function nextLensSql(page: Page, action: () => Promise<unknown>): Promise<string> {
  const req = page.waitForRequest(
    (r) => r.url().includes('/api/ds/query') && (r.postData() ?? '').includes('LIMIT 10000')
  );
  await action();
  return (await req).postData() ?? '';
}

test('Filter by limits one metric to matching documents (KQL compiled, conditional aggregate)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: byService({ kind: 'metric', id: 'm0', op: 'count' }) });
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();

  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page)
    .getByRole('button', { name: /Advanced/ })
    .click();
  const box = editor(page).getByRole('textbox', { name: 'Filter by' });
  await box.fill('SeverityText : error');
  const sql = await nextLensSql(page, () => box.press('Enter'));
  expect(sql).toContain('countIf(');
  await expect(viz.chart.getByText(FIXTURE.counts.errorsByService.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(FIXTURE.counts.errorsByService.checkout.toLocaleString('en-US'), { exact: true })).toBeVisible();
  // Kept in the URL, so a reload shows the same chart.
  expect(new URL(page.url()).searchParams.get('lens')).toContain('"filter":"SeverityText : error"');
});

test('invalid Filter by KQL stays in the box with a message and is not applied', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: byService({ kind: 'metric', id: 'm0', op: 'count' }) });
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page)
    .getByRole('button', { name: /Advanced/ })
    .click();
  const box = editor(page).getByRole('textbox', { name: 'Filter by' });
  await box.fill('SeverityText : (');
  await box.press('Enter');
  await expect(editor(page).getByRole('alert')).toBeVisible();
  expect(new URL(page.url()).searchParams.get('lens')).not.toContain('filter');
});

test('Time shift: preset adds a shifted copy of the data, labelled "1d ago"', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: byService({ kind: 'metric', id: 'm0', op: 'count' }) });
  // Let the initial (unshifted) query land first: it is sent after field discovery and would
  // otherwise be the "next" request captured below.
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
  await viz.dimensions.getByRole('button', { name: 'Edit Count of records' }).click();
  await editor(page)
    .getByRole('button', { name: /Advanced/ })
    .click();
  const sql = await nextLensSql(page, () => editor(page).getByRole('button', { name: 'Time shift 1d' }).click());
  expect(sql).toContain('ARRAY JOIN [0, 1] AS __s');
  expect(sql).toContain('INTERVAL 1 DAY');
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await expect(viz.group('Vertical axis').or(viz.dimensions)).toContainText('Count of records (1d ago)');
  await expect(viz.chart).toBeVisible();
});

test('a tampered time shift in a shared link never reaches SQL', async ({ page }) => {
  const viz = new VisualizePage(page);
  const sql = await nextLensSql(page, () =>
    viz.open({ lens: byService({ kind: 'metric', id: 'm0', op: 'count', shift: "1d') OR 1=1 --" }) })
  );
  expect(sql).not.toContain('OR 1=1');
  expect(sql).not.toContain('ARRAY JOIN');
  await expect(viz.chart.getByText(FIXTURE.counts.payments.toLocaleString('en-US'), { exact: true })).toBeVisible();
});

test('Appearance: value format, colour and right axis on an XY chart', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: JSON.stringify({
      chartType: 'line',
      subType: 'unstacked',
      buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
      metrics: [
        { kind: 'metric', id: 'm0', op: 'count', color: '#ff0000' },
        { kind: 'metric', id: 'm1', op: 'count', format: { id: 'bytes' }, axis: 'right' },
      ],
    }),
  });
  await expect(viz.chart.getByTestId('lens-right-tick').first()).toBeVisible();
  await expect(viz.chart.getByTestId('lens-right-tick').filter({ hasText: /B$/ }).first()).toBeVisible();
  await expect(viz.chart.locator('circle[fill="#ff0000"]').first()).toBeVisible();
});
