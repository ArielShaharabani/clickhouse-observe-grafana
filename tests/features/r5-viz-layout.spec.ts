import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';

// R5-VIZ-LAYOUT: resizable Fields / Dimensions panes, a paginated Table chart, and no repeated
// page name in the breadcrumbs.

test.describe('Visualize layout', () => {
  test('the Fields pane is resizable with the keyboard and remembers its width', async ({ page }) => {
    const viz = new VisualizePage(page);
    await viz.open();
    const handle = page.getByRole('separator').first();
    const before = (await viz.fields.boundingBox())!.width;
    await handle.focus();
    // The splitter moves while the key is held (time-based), so a tap does nothing.
    await page.keyboard.down('ArrowRight');
    await page.waitForTimeout(400);
    await page.keyboard.up('ArrowRight');
    await expect.poll(async () => (await viz.fields.boundingBox())!.width).toBeGreaterThan(before);
    const resized = (await viz.fields.boundingBox())!.width;
    await page.reload();
    await expect(viz.fields).toBeVisible();
    expect(Math.abs((await viz.fields.boundingBox())!.width - resized)).toBeLessThan(4);
  });

  test('the Dimensions pane has its own drag handle', async ({ page }) => {
    const viz = new VisualizePage(page);
    await viz.open();
    await expect(page.getByRole('separator')).toHaveCount(2);
  });

  test('breadcrumbs do not repeat the page name', async ({ page }) => {
    await page.goto('/a/poortuna-clickhouse-observe-app/logs');
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumbs' });
    await expect(crumbs.getByText('Discover')).toHaveCount(1);
  });
});
