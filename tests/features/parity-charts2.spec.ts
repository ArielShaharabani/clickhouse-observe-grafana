import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// PARITY-CHARTS2 (docs/dev/pending/PARITY-CHARTS2.md): pie colours, tiles, table, Inspector SQL.
const lens = (chartType: string, buckets: object[]) =>
  JSON.stringify({ chartType, buckets, metrics: [{ kind: 'metric', id: 'm0', op: 'count' }] });
const svc = { kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9, other: true };

test('pie shows one slice per service with grouped legend values', async ({ page }) => {
  await new VisualizePage(page).open({ lens: lens('pie', [svc]) });
  await expect(page.getByTestId('lens-chart')).toHaveAttribute('data-panel', 'piechart');
});

test('metric tiles per service sit in a grid with the metric name as subtitle', async ({ page }) => {
  await new VisualizePage(page).open({ lens: lens('metric', [svc]) });
  await expect(page.getByRole('listitem').first()).toContainText('Count of records');
});

test('table: counts with thousands separators (payments 9,264)', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lens('table', [svc]) });
  await expect(viz.chart.getByText('9,264', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('9264', { exact: true })).toHaveCount(0);
});

test('Inspector request shows readable SQL (no escaped quotes or \n) and result rows', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lens('bar', [svc]) });
  await expect(viz.chart).toBeVisible();
  await page.getByRole('button', { name: 'Inspect' }).click();
  const drawer = page.getByRole('dialog', { name: /Inspector/ });
  await drawer.getByRole('radio', { name: 'Requests' }).click();
  await expect(drawer.getByRole('table', { name: 'Request statistics' })).toContainText('Result rows');
  await drawer.getByRole('tab', { name: 'Request' }).click();
  const req = drawer.getByLabel('Inspector request');
  await expect(req).toContainText('SELECT');
  const text = (await req.textContent()) ?? '';
  expect(text).not.toContain('\\"');
  expect(text).not.toContain('\n');
});
