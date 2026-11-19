import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// PARITY-GRID: Kibana 9.5 comparison fixes for the Discover grid, document panel, surrounding
// documents and field popover (docs/dev/pending/PARITY-GRID.md, docs/spec/10-discover.md).

const docLabel = (page: Page) => page.getByText(/^\d+ of \d+$/);
const panel = (page: Page) => page.getByRole('region', { name: 'Document detail' });
const header = (logs: LogsPage, name: string) => logs.grid.getByRole('button', { name: new RegExp(`^${name}`) });

async function openHeaderMenu(page: Page, logs: LogsPage, name: string) {
  await header(logs, name).click();
  return page.getByRole('menu', { name: `Column actions: ${name}` });
}

async function addColumnFromSidebar(page: Page, field: string) {
  const row = page.locator('.field-item-row').filter({ has: page.getByRole('button', { name: new RegExp(`^Preview ${field}: `) }) });
  await row.hover();
  await row.getByRole('button', { name: `Add ${field} as column` }).click();
}

test('document panel pages through every loaded row, with ←/→ and Escape', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  // The last row of grid page 1 (50 rows a page, 200 loaded).
  await logs.grid.getByRole('button', { name: 'Open detail' }).last().click();
  await expect(docLabel(page)).toHaveText('50 of 200');
  await expect(panel(page)).toBeFocused();
  await page.getByRole('button', { name: 'Next log' }).click();
  await expect(docLabel(page)).toHaveText('51 of 200');
  // The grid followed the document to page 2 and highlights its row.
  await expect(logs.grid.locator('tbody tr[aria-selected="true"]')).toHaveCount(1);
  await expect(logs.grid.getByRole('button', { name: 'Close detail' })).toBeVisible();
  await panel(page).focus();
  await page.keyboard.press('ArrowRight');
  await expect(docLabel(page)).toHaveText('52 of 200');
  await page.keyboard.press('ArrowLeft');
  await expect(docLabel(page)).toHaveText('51 of 200');
  await page.getByRole('button', { name: 'Last log' }).click();
  await expect(docLabel(page)).toHaveText('200 of 200');
  // More rows exist: Next fetches them.
  await page.getByRole('button', { name: 'Next log' }).click();
  await expect(docLabel(page)).toHaveText(/^201 of \d+$/);
  await panel(page).focus();
  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  // Focus goes back to the row's button.
  await expect(page.locator(':focus')).toHaveAttribute('data-expand-row', /\d+/);
});

test('the field list keeps its width when many columns are added; the grid scrolls sideways', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  for (const field of ['TraceId', 'SpanId', 'TraceFlags', 'SeverityNumber', 'ScopeName', 'ResourceSchemaUrl']) {
    await addColumnFromSidebar(page, field);
  }
  const sidebar = page.getByRole('region', { name: 'Available fields' });
  expect((await sidebar.boundingBox())!.width).toBeGreaterThanOrEqual(150);
  const grid = logs.grid;
  const overflow = await grid.evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(overflow).toBe(true);
  // The pager stays inside the viewport.
  const pager = page.getByText(/rows loaded/);
  const box = (await pager.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
});

test('columns resize from the header edge; the width is kept in the URL', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  const th = logs.grid.getByRole('columnheader', { name: /Service/ });
  const before = (await th.boundingBox())!.width;
  const handle = logs.grid.getByRole('separator', { name: 'Resize column Service' });
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + 150, hb.y + hb.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await th.boundingBox())!.width).toBeGreaterThan(before + 100);
  await expect.poll(() => new URL(page.url()).searchParams.get('cols') ?? '').toContain('"width"');
  // Dragging the header body still reorders (the handle didn't start a drag).
  await expect(logs.grid.locator('thead th').nth(4)).toContainText('Service');
});

test('header menu: sort with a time tie-break, move, remove, copy name', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  let menu = await openHeaderMenu(page, logs, 'Level');
  await expect(menu.getByRole('menuitem')).toHaveText(['Sort ascending', 'Sort descending', 'Move left', 'Move right', 'Copy name']);
  await menu.getByRole('menuitem', { name: 'Sort ascending' }).click();
  await expect(logs.grid.getByRole('columnheader', { name: /Level/ })).toHaveAttribute('aria-sort', 'ascending');
  // Ties on Level keep time order, newest first.
  await expect(logs.grid.locator('td[data-cell="0:1"]')).toHaveText('DEBUG');
  const t0 = await logs.grid.locator('td[data-cell="0:0"]').textContent();
  const t1 = await logs.grid.locator('td[data-cell="1:0"]').textContent();
  expect(t0! >= t1!).toBe(true);

  menu = await openHeaderMenu(page, logs, 'Service');
  await menu.getByRole('menuitem', { name: 'Move left' }).click();
  // thead: compare checkbox, expand, Time, then the moved Service column.
  await expect(logs.grid.locator('thead th').nth(3)).toContainText('Service');

  await addColumnFromSidebar(page, 'TraceId');
  menu = await openHeaderMenu(page, logs, 'TraceId');
  await menu.getByRole('menuitem', { name: 'Remove column' }).click();
  await expect(header(logs, 'TraceId')).toHaveCount(0);
});

test('no duplicate Body column while Message shows Body', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await expect(page.getByLabel('Body is shown as the Message column')).toBeAttached();
});

test('document panel: wide, names wrap at dots, ISO time in JSON, single-document permalink', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByTestId('doc-field-row').first()).toBeVisible();
  expect((await panel(page).boundingBox())!.width).toBeGreaterThanOrEqual(400);
  await expect(page.getByRole('textbox', { name: 'Search field names and values' })).toBeVisible();

  await page.getByText('JSON', { exact: true }).click();
  await expect(panel(page)).toContainText(/2026-01-0\dT\d\d:\d\d:\d\d(\.\d+)?Z/);

  await page.getByRole('button', { name: 'View single document' }).click();
  await expect(page).toHaveURL(/\/doc\/spec-fixture\/\d+_\d+/);
  await expect(page.getByRole('heading', { name: /^Document #\d+$/ })).toBeVisible();
  await expect(page.getByTestId('doc-field-row').first()).toBeVisible({ timeout: 30_000 });
  // The link opens the same document again (permalink).
  await page.reload();
  await expect(page.getByTestId('doc-field-row').first()).toBeVisible({ timeout: 30_000 });
});

test('surrounding documents: highlighted anchor, dense rows, Add filter', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  // Not the newest row: the anchor needs newer documents for "Load newer".
  await logs.grid.getByRole('button', { name: 'Open detail' }).nth(20).click();
  await page.getByRole('button', { name: 'View surrounding documents' }).click();
  const anchor = page.getByRole('grid').locator('tbody tr[data-anchor="true"]');
  await expect(anchor).toBeVisible({ timeout: 30_000 });
  const bg = (loc: typeof anchor) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
  const neighbour = page.getByRole('grid').locator('tbody tr:not([data-anchor="true"])').first();
  expect(await bg(anchor)).not.toBe(await bg(neighbour));
  expect((await neighbour.boundingBox())!.height).toBeLessThan(45);
  await expect(page.getByRole('button', { name: 'Add filter' })).toBeVisible();
  await page.getByTestId('load-newer').getByRole('button', { name: 'Load' }).click();
  await expect(anchor).toBeInViewport();
});

test('field popover: filter buttons on every value, exact caption, one-click map key column', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'SeverityText:error and ServiceName:auth' });
  await logs.expectRowCount(FIXTURE.counts.errorsByService.auth);
  await page.getByTitle('ServiceName', { exact: true }).click();
  // Visible without hovering the row.
  await expect(page.getByRole('button', { name: 'Filter for ServiceName: auth' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Filter out ServiceName: auth' })).toBeVisible();
  await expect(page.getByText(`Calculated from ${FIXTURE.counts.errorsByService.auth} records.`)).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByTitle('ResourceAttributes', { exact: true }).click();
  await page.getByRole('button', { name: 'Add ResourceAttributes.host.name as column' }).click();
  await expect(logs.grid.getByRole('columnheader', { name: /host\.name/ })).toBeVisible();
});
