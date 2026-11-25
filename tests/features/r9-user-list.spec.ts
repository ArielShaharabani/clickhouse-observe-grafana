import { test, expect } from '../fixtures';

const APP = '/a/poortuna-clickhouse-observe-app';

test('the histogram is hidden when nothing matches', async ({ page }) => {
  await page.goto(`${APP}/logs?ds=spec-fixture&from=${Date.UTC(2025, 0, 3)}&to=${Date.UTC(2025, 0, 4)}`);
  await expect(page.getByText('No results match your search criteria')).toBeVisible();
  await expect(page.getByTestId('histogram-resize-handle')).toHaveCount(0);
});

test('the missing data view notice leaves the page to the results', async ({ page }) => {
  await page.goto(`${APP}/logs?ds=dv_missing`);
  const notice = page.getByText("This link's data view isn't available in this browser");
  await expect(notice).toBeVisible();
  await expect(page.getByTestId('histogram-resize-handle')).toBeVisible();
  const box = await page.getByRole('button', { name: 'Saved searches' }).first().boundingBox();
  const at = await notice.boundingBox();
  expect(box!.y - at!.y).toBeLessThan(160);
});

test('the Quick function / Formula toggle keeps its height', async ({ page }) => {
  await page.goto(`${APP}/visualize?ds=spec-fixture`);
  await page.getByText('+ Add or drag-and-drop a field').nth(1).click();
  const toggle = page.getByRole('radiogroup', { name: 'Metric mode' });
  if (!(await toggle.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /Count of records|Records/ }).first().click();
  }
  await toggle.getByRole('radio', { name: 'Formula' }).check({ force: true });
  await expect(page.getByText('Ctrl+Enter or leave the box to apply')).toBeVisible();
  expect((await toggle.boundingBox())!.height).toBeLessThan(50);
});
