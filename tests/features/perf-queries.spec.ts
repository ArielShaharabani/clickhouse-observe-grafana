import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// PERF-QUERIES (docs/dev/pending/PERF-QUERIES.md): chart-type switches reuse the last result (#5),
// the Discover histogram axis uses Visualize's number format (#9).
const lens = (chartType: string) =>
  JSON.stringify({
    chartType,
    buckets: [{ kind: 'date_histogram', id: 'b0', field: 'Timestamp', label: 'Timestamp' }],
    metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
  });

test('switching Bar -> Line -> Area sends no new query; Refresh does', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({ lens: lens('bar') });
  await expect(viz.chart).toBeVisible();
  let queries = 0;
  page.on('request', (r) => {
    if (r.url().includes('/api/ds/query')) {
      queries++;
    }
  });
  for (const type of ['Line', 'Area']) {
    await page.getByRole('button', { name: /^Chart type:/ }).click();
    await page.getByRole('option', { name: type, exact: true }).click();
    await expect(viz.chart).toBeVisible();
  }
  await page.waitForTimeout(500);
  expect(queries).toBe(0);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect.poll(() => queries).toBeGreaterThan(0);
});

test('Discover histogram axis uses separators / abbreviations like Visualize (no "1 Mil")', async ({ page }) => {
  await new LogsPage(page).open();
  const axis = page.getByTestId('histogram-y-axis');
  await expect(axis).toBeVisible();
  const text = (await axis.textContent()) ?? '';
  expect(text).not.toMatch(/Mil|\bK\b/);
  // Every tick is a plain number with optional thousands separators, or abbreviated from a million up.
  for (const tick of await axis.locator('span').allTextContents()) {
    expect(tick).toMatch(/^-?(\d{1,3}(,\d{3})*(\.\d+)?|\d+(\.\d+)?[MBT])$/);
  }
});
