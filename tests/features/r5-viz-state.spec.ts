import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// R5-VIZ-STATE: empty dimension slots, an axis chart keeps its type when X is removed.

test('an empty workspace shows the dimension slots to fill manually', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({});
  await expect(viz.dimensions.getByRole('group', { name: 'Horizontal axis' })).toBeVisible();
  await expect(viz.dimensions.getByRole('button', { name: 'Add to Vertical axis' })).toBeVisible();
  await expect(viz.dimensions.getByRole('button', { name: 'Add to Breakdown' })).toBeVisible();
});

test('removing the horizontal axis leaves an empty visualization, not a Metric', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: JSON.stringify({
      chartType: 'bar',
      buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
      metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    }),
  });
  await viz.dimensions.getByRole('button', { name: 'Remove Top 9 values of ServiceName' }).click();
  await expect(viz.dimensions.getByRole('button', { name: 'Add to Horizontal axis' })).toBeVisible();
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();
});

test('inspect request shows the executed SQL first', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open({
    lens: JSON.stringify({
      chartType: 'bar',
      buckets: [{ kind: 'terms', id: 'b0', field: 'ServiceName', label: 'ServiceName', size: 9 }],
      metrics: [{ kind: 'metric', id: 'm0', op: 'count' }],
    }),
  });
  await page.getByRole('button', { name: 'Inspect' }).click();
  await page.getByRole('dialog', { name: /Inspector/ }).getByRole('radio', { name: 'Requests' }).click();
  await page.getByRole('tab', { name: 'Request' }).click();
  await expect(page.getByText('-- executedSql')).toBeVisible();
});
