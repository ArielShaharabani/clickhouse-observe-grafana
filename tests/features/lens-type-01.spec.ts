import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// LENS-TYPE-01 one-menu chart switching (docs/spec/20-lens.md).

async function switchTo(page: import('@playwright/test').Page, from: string, to: string) {
  await page.getByRole('button', { name: `Chart type: ${from}` }).click();
  // "Bar" must not also match "Bar horizontal" (R3-CHARTS).
  await page.getByRole('option', { name: new RegExp(`^${to}(?! horizontal)`) }).click();
}

test('Metric → Bar/Line and back: one open + one selection, query and time unchanged', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ q: 'ServiceName:payments' });
  await viz.addField('Records');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');
  const before = new URL(page.url()).searchParams;

  await switchTo(page, 'Line', 'Metric');
  await expect(viz.chart).toHaveAttribute('data-panel', 'tiles');
  await expect(viz.group('Primary metric')).toContainText('Count of records');

  await switchTo(page, 'Metric', 'Bar');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await expect(viz.group('Horizontal axis')).toContainText('Timestamp'); // time axis added back

  await switchTo(page, 'Bar', 'Line');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'line');

  const after = new URL(page.url()).searchParams;
  for (const k of ['q', 'from', 'to', 'ds']) {
    expect(after.get(k)).toBe(before.get(k));
  }
});

test('keyboard: type to filter and press Enter; sub-type switches stacking', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await page.getByRole('button', { name: 'Chart type: Bar' }).click();
  await expect(page.getByRole('combobox', { name: 'Search visualizations' })).toBeFocused();
  await page.keyboard.type('Table');
  await page.keyboard.press('Enter');
  await expect(viz.chart).toHaveAttribute('data-panel', 'table');
  await expect(viz.group('Rows')).toContainText('Top 9 values of ServiceName');

  await page.getByRole('button', { name: 'Chart type: Table' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  await switchTo(page, 'Table', 'Bar');
  await page.getByRole('radio', { name: 'Percentage' }).click();
  await expect(page.getByText('Bar percentage').first()).toBeVisible();
});

test('removing the only axis of a bar chart sticks (empty visualization, type kept)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await expect(viz.chart).toHaveAttribute('data-chart-type', 'bar');
  await viz.dimensions.getByRole('button', { name: 'Remove Top 9 values of ServiceName' }).click();
  await expect(viz.dimensions.getByRole('button', { name: 'Add to Horizontal axis' })).toBeVisible();
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();
});

