import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// Round 6: the vertical axis can be removed while the horizontal axis is set; the workspace is empty again.
test('removing the vertical axis empties the workspace; adding a metric brings the chart back', async ({ page }) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await expect(viz.chart).toBeVisible();

  const y = viz.group('Vertical axis');
  await y.getByRole('button', { name: /^Remove / }).click();
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();
  await expect(y.getByRole('button', { name: /^Remove / })).toHaveCount(0);
  await expect(viz.chart).toHaveCount(0);
  // It sticks across a reload, and the horizontal axis is kept.
  await page.reload();
  await expect(page.getByText('Drop some fields here to start')).toBeVisible();
  await expect(viz.group('Horizontal axis')).toContainText('ServiceName');

  await y.getByRole('button', { name: 'Add to Vertical axis' }).click();
  await expect(viz.chart).toBeVisible();
});
