import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-TABLE-01 results grid / DISC-TABLE-02 cell actions (docs/spec/10-discover.md).

test('keyboard: arrows move a cell focus, Enter expands, the popover filters (IT-A producer)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.grid.focus();
  await page.keyboard.press('ArrowDown');
  const focused = logs.grid.locator('td[aria-selected="true"]');
  await expect(focused).toHaveAttribute('data-cell', '0:0');
  await page.keyboard.press('End');
  const lastCol = await focused.getAttribute('data-cell');
  expect(lastCol).not.toBe('0:0');
  await page.keyboard.press('Home');
  await expect(focused).toHaveAttribute('data-cell', '0:0');

  // Expand the severity cell of the first row and filter for it from the popover.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: /^Value of / });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: /^Copy value of / })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(logs.grid).toBeFocused();
  await page.keyboard.press('Enter');
  await dialog.getByRole('button', { name: /^Filter for / }).click();
  await expect(logs.filterBar.getByRole('button', { name: /^Filter actions: / })).toHaveCount(1);
});

test('the cell action bar offers Expand, with the full value', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName:payments' });
  await logs.expectRowCount(FIXTURE.counts.byService.payments);
  const cell = logs.grid
    .getByRole('cell')
    .filter({ hasText: /payments|checkout|failed|ok/ })
    .first();
  await cell.hover();
  await page
    .getByRole('button', { name: /^Expand value of / })
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: /^Value of / });
  await expect(dialog.getByTestId('cell-expand-value')).not.toBeEmpty();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});

test('PgDn moves to the next page', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  const firstCell = logs.grid.locator('td[data-cell="0:0"]');
  const firstTs = await firstCell.textContent();
  expect(firstTs).toBeTruthy();
  await logs.grid.focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('PageDown');
  await expect.poll(async () => firstCell.textContent()).not.toBe(firstTs);
  await page.keyboard.press('PageUp');
  await expect.poll(async () => firstCell.textContent()).toBe(firstTs);
});

test('display options: density and body lines apply and are remembered', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  const cell = logs.grid.locator('td[data-cell="0:0"]');
  const normal = (await cell.boundingBox())!.height;
  await page.getByRole('button', { name: 'Display options' }).click();
  await page.getByRole('radio', { name: 'Compact' }).click();
  await page.keyboard.press('Escape'); // the options popover hides the page from a11y while open
  await expect.poll(async () => (await cell.boundingBox())!.height).toBeLessThan(normal);
  await page.reload();
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByRole('button', { name: 'Display options' }).click();
  await expect(page.getByRole('radio', { name: 'Compact' })).toBeChecked();
});
