import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-SEARCH-03 query menu (docs/spec/10-discover.md): ⋮ left of the query input with Apply to
// all, Clear all, Load query, Save query (query + filters) and the query language.

const paymentsPill = { id: 'e2e-payments', field: 'ServiceName', op: '=', value: 'payments' };
const { total } = FIXTURE.counts;

const queryMenu = (page: Page) => page.getByRole('button', { name: 'Query menu' });
const menuItem = (page: Page, name: string | RegExp) =>
  page.getByRole('menu', { name: 'Query menu' }).getByRole('menuitem', { name });

async function openMenu(page: Page) {
  await queryMenu(page).click();
  await expect(page.getByRole('menu', { name: 'Query menu' })).toBeVisible();
}

test('Save query stores query + filters; Load query restores them on a clean page', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'SeverityText : error', filters: JSON.stringify([paymentsPill]) });
  await logs.expectRowCount(FIXTURE.counts.paymentsErrors);

  await openMenu(page);
  await menuItem(page, 'Save query').click();
  await page.getByLabel('Saved query name').fill('Payment errors');
  await page.getByRole('button', { name: 'Save', exact: true }).click();

  // Clear all removes the query and the filters.
  await openMenu(page);
  await menuItem(page, 'Clear all').click();
  await logs.expectRowCount(total);
  await expect(logs.searchInput).toHaveValue('');
  await expect(logs.filterBar).toHaveCount(0);

  await openMenu(page);
  await menuItem(page, 'Load query').hover();
  await page.getByRole('menuitem', { name: 'Payment errors', exact: true }).click();
  await expect(logs.searchInput).toHaveValue('SeverityText : error');
  await expect(logs.pill('ServiceName')).toBeVisible();
  await logs.expectRowCount(FIXTURE.counts.paymentsErrors);
});

test('a duplicate name is rejected', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'SeverityText : warn' });
  for (const attempt of [1, 2]) {
    await openMenu(page);
    await menuItem(page, attempt === 1 ? 'Save query' : 'Save as new query').click();
    await page.getByLabel('Saved query name').fill('Warnings');
    if (attempt === 1) {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
    }
  }
  await expect(page.getByText('Name conflicts with an existing saved query')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
});

test('Apply to all disables, re-enables and inverts every filter', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([paymentsPill]) });
  await logs.expectRowCount(FIXTURE.counts.payments);

  await openMenu(page);
  await menuItem(page, 'Apply to all').hover();
  await page.getByRole('menuitem', { name: 'Disable all' }).click();
  await logs.expectRowCount(total);
  await expect(logs.pill('ServiceName')).toHaveAccessibleName(/\(disabled\)$/);

  await openMenu(page);
  await menuItem(page, 'Apply to all').hover();
  await page.getByRole('menuitem', { name: 'Enable all' }).click();
  await logs.expectRowCount(FIXTURE.counts.payments);

  await openMenu(page);
  await menuItem(page, 'Apply to all').hover();
  await page.getByRole('menuitem', { name: 'Invert inclusion' }).click();
  await logs.expectRowCount(total - FIXTURE.counts.payments);
});

test('a hostile saved query in storage is sanitized on load', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.evaluate(() => {
    window.localStorage.setItem(
      'poortuna-clickhouse-observe:saved-queries',
      JSON.stringify([
        {
          id: 'evil',
          name: 'Evil',
          query: '',
          filters: [
            { id: 'x', field: 'ServiceName', op: "=') OR 1=1 --", value: 'v' },
            { id: 'ok', field: 'ServiceName', op: '=', value: 'payments' },
          ],
          timeRange: { from: "now-1h'); DROP TABLE t; --", to: 'now' },
        },
      ])
    );
  });
  await openMenu(page);
  await menuItem(page, 'Load query').hover();
  await page.getByRole('menuitem', { name: 'Evil', exact: true }).click();
  // Only the well-formed pill survives; the time range is ignored.
  await expect(logs.filterBar.getByRole('button', { name: /^Filter actions: / })).toHaveCount(1);
  await logs.expectRowCount(FIXTURE.counts.payments);
  expect(new URL(page.url()).searchParams.get('from')).toBe(String(FIXTURE.from));
});

test('the language section shows KQL and Lucene as unsupported', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openMenu(page);
  await expect(page.getByRole('menuitemradio', { name: 'KQL', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('menuitemradio', { name: /Lucene/ })).toHaveAttribute('data-disabled', 'true');
});
