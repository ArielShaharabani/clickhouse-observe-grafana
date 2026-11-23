import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// R4-DISCOVER (round 3 rows 1-4, 9, 10, 12-14). Written for the coordinator's run.

test('document panel pushes the grid on a wide page and overlays it on a narrow one', async ({ page }) => {
  const logs = new LogsPage(page);
  await page.setViewportSize({ width: 1600, height: 900 });
  await logs.open();
  const wide = await logs.grid.boundingBox();
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByRole('region', { name: 'Document detail' })).toBeVisible();
  await expect.poll(async () => (await logs.grid.boundingBox())?.width ?? 0).toBeLessThan((wide?.width ?? 0) - 200);

  await page.setViewportSize({ width: 1000, height: 800 });
  await logs.open();
  const narrow = await logs.grid.boundingBox();
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByRole('region', { name: 'Document detail' })).toBeVisible();
  const after = await logs.grid.boundingBox();
  expect(after?.width).toBeGreaterThanOrEqual((narrow?.width ?? 0) - 2);
  await expect(page.getByRole('button', { name: /next page|Next/i }).first()).toBeVisible();
});

test('unknown personal data view in a link shows a notice', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ ds: 'dv_not_in_this_browser' });
  await expect(page.getByText("This link's data view isn't available in this browser")).toBeVisible();
});
