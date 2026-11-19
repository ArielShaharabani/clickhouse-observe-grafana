import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// LENS-INTERACT-01 click-to-filter drilldown (docs/spec/20-lens.md); IT-A producer, IT-B shared filters.

const filterBar = (page: import('@playwright/test').Page) => page.getByTestId('filter-pills');

test('single dimension: one click on a bar adds its filter and re-runs; Discover sees it', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await viz.chart.getByRole('button', { name: /^payments · Count of records: / }).click();
  await expect(filterBar(page).getByRole('button', { name: /^Filter actions: ServiceName = payments/ })).toBeVisible();
  await expect(viz.chart.getByRole('button', { name: /^checkout · / })).toHaveCount(0);
  await expect(viz.chart.getByRole('button', { name: /^payments · Count of records: 9,264$/ })).toBeVisible();

  // Same URL on Discover: the pill is there and the count matches.
  const url = page.url().replace('/visualize?', '/logs?');
  await page.goto(url);
  const logs = new LogsPage(page);
  await expect(logs.pill('ServiceName = payments')).toBeVisible();
  await logs.expectRowCount(FIXTURE.counts.payments);
});

test('stacked segment: "Select filters to apply" with both values ticked; untick one, Apply', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await viz.addField('SeverityText');
  await viz.chart.getByRole('button', { name: /^payments · error: / }).click();
  const dialog = page.getByRole('dialog', { name: 'Select filters to apply' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await dialog.getByText('ServiceName: payments').click(); // untick
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(filterBar(page).getByRole('button', { name: /^Filter actions: SeverityText = error/ })).toBeVisible();
  await expect(filterBar(page).getByRole('button', { name: /^Filter actions: ServiceName/ })).toHaveCount(0);
  await expect(viz.chart.getByRole('button', { name: /^payments · error: 1,575$/ })).toBeVisible();
  await expect(viz.chart.getByRole('button', { name: /· info: / })).toHaveCount(0);
});

test('legend ⋮ → Filter out; Cancel in the chooser changes nothing', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await viz.addField('SeverityText');
  await viz.chart.getByRole('button', { name: /^auth · info: / }).click();
  await page.getByRole('dialog', { name: 'Select filters to apply' }).getByRole('button', { name: 'Cancel' }).click();
  await expect(filterBar(page).getByRole('button', { name: /^Filter actions: / })).toHaveCount(0);

  await page.getByRole('button', { name: 'Legend actions for debug' }).click();
  await page.getByRole('menuitem', { name: 'Filter out' }).click();
  await expect(filterBar(page).getByRole('button', { name: /^Filter actions: SeverityText ≠ debug/ })).toBeVisible();
  await expect(viz.chart.getByRole('button', { name: /· debug: / })).toHaveCount(0);
});

test('time series: brushing sets the time range', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  const area = page.getByTestId('lens-plot-area');
  const box = (await area.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.4, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).not.toBe(String(FIXTURE.from));
  const from = Number(new URL(page.url()).searchParams.get('from'));
  const to = Number(new URL(page.url()).searchParams.get('to'));
  expect(from).toBeGreaterThan(FIXTURE.from);
  expect(to).toBeLessThan(FIXTURE.to);
});

test('time bucket + breakdown in one Apply: both the filter and the time range are kept', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('Records');
  await viz.addField('ServiceName');
  await viz.chart
    .getByRole('button', { name: /^\S+ \S+ · payments: / })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Select filters to apply' });
  await expect(dialog.getByRole('checkbox')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(filterBar(page).getByRole('button', { name: /^Filter actions: ServiceName = payments/ })).toBeVisible();
  const sp = new URL(page.url()).searchParams;
  expect(sp.get('filters')).toContain('payments');
  expect(Number(sp.get('to')) - Number(sp.get('from'))).toBeLessThan(FIXTURE.to - FIXTURE.from);
});
