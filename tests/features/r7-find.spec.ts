import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// Ctrl+F inside the document panel's JSON and a cell's expanded value.

test('Ctrl+F in the JSON tab finds, steps, and Escape closes only the bar', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  const panel = page.getByRole('region', { name: 'Document detail' });
  await panel.getByRole('tab', { name: 'JSON' }).click();
  await expect(panel.getByText('"ServiceName"')).toBeVisible();
  await panel.getByRole('button', { name: 'Collapse' }).nth(1).click();
  await page.keyboard.press('Control+f');
  const bar = panel.getByRole('search');
  const input = bar.getByRole('textbox', { name: 'Find' });
  await expect(input).toBeFocused();
  await expect(panel.getByRole('button', { name: 'Expand', exact: true }).and(panel.locator('[class*="gutter"]'))).toHaveCount(0);
  await input.fill('servicename');
  await expect(bar.getByRole('status')).toHaveText(/^1 of \d+$/);
  await bar.getByRole('button', { name: 'Match case' }).click();
  await expect(bar.getByRole('status')).toHaveText('No results');
  await bar.getByRole('button', { name: 'Match case' }).click();
  await input.fill('"');
  await input.press('Enter');
  await expect(bar.getByRole('status')).toHaveText(/^2 of /);
  await input.press('Shift+Enter');
  await input.press('Shift+Enter');
  await expect(bar.getByRole('status')).toHaveText(/^(\d+) of \1$/);
  const painted = await page.evaluate(() => {
    const h = (CSS as unknown as { highlights: Map<string, { size: number }> }).highlights;
    return [h.get('observe-find')?.size ?? 0, h.get('observe-find-current')?.size ?? 0];
  });
  expect(painted[0]).toBeGreaterThan(10);
  expect(painted[1]).toBe(1);
  await input.press('Escape');
  await expect(bar).toHaveCount(0);
  await expect(panel).toBeVisible();
  // Focus is back in the panel: Ctrl+F opens it again.
  await page.keyboard.press('Control+f');
  await expect(input).toBeFocused();
});

test('Ctrl+F in an expanded cell; Escape closes the bar first, then the popover', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.grid.locator('[data-cell="0:3"]').click();
  const dialog = page.getByRole('dialog', { name: /^Value of/ });
  await page.keyboard.press('Control+f');
  const input = dialog.getByRole('textbox', { name: 'Find' });
  await input.fill('e');
  await expect(dialog.getByRole('status')).toHaveText(/^1 of/);
  await input.press('Escape');
  await expect(input).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});
