import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import pluginJson from '../../src/plugin.json';

// DISC-DOC-02 surrounding documents (docs/spec/10-discover.md) + integration IT-I (drawer →
// surrounding documents: filters disabled, query dropped, columns kept) and the context-view part
// of IT-F (columns carried over).
//
// Fixture facts (default.spec_logs, incident window): the anchor "Order 22364 created" (payments,
// 2026-01-05 09:00:30) shares its timestamp with "Timeout after 3821ms calling inventory"; the
// row id orders that one first among the older documents. Newer, closest first:
// 09:00:36 payments 75172 · 09:00:42 payments 6617ms · 09:00:45 inventory 46162 ·
// 09:00:48 payments 66150 · 09:00:54 payments 6550ms · 09:01:00 payments 44302 · 09:01:00 auth cache hit.
// Older, closest first: 09:00:30 payments 3821ms · 09:00:24 payments 48058 · 09:00:18 payments 3179ms ·
// 09:00:15 frontend retrying · 09:00:12 payments 56873 · 09:00:06 payments 5423ms · 09:00:00 (checkout / payments).

// Each test runs several pages and queries; give them room on a loaded Docker VM.
test.describe.configure({ timeout: 120_000 });

const ANCHOR_BODY = 'Order 22364 created';
const ANCHOR_ID = '15918698468527039780';
const paymentsPill = { id: 'e2e-payments', field: 'ServiceName', op: '=', value: 'payments' };

const rows = (page: Page) => page.getByRole('grid').locator('tbody tr');
const anchorRow = (page: Page) => page.getByRole('grid').locator('tbody tr[data-anchor="true"]');

/** Discover with the anchor as the only hit, open its detail panel, then "View surrounding documents". */
async function openSurrounding(page: Page, params: Record<string, string> = {}) {
  const logs = new LogsPage(page);
  await logs.open({ q: `"${ANCHOR_BODY}"`, ...params });
  await logs.expectRowCount(1);
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await page.getByRole('button', { name: 'View surrounding documents' }).click();
  await expect(page.getByRole('heading', { name: `Documents surrounding #${ANCHOR_ID}` })).toBeVisible({
    timeout: 45_000,
  });
  await expect(anchorRow(page)).toContainText(ANCHOR_BODY, { timeout: 30_000 });
  return logs;
}

test('opens from the detail panel: 5 newer + anchor + 5 older, anchor highlighted, ties ordered', async ({ page }) => {
  await openSurrounding(page);
  expect(new URL(page.url()).pathname).toMatch(
    new RegExp(`/a/${pluginJson.id}/context/spec-fixture/\\d+_${ANCHOR_ID}$`)
  );
  await expect(page.getByRole('navigation', { name: 'Breadcrumb', exact: true })).toHaveText(
    /Discover\s*\/\s*Surrounding documents/
  );
  await expect(rows(page)).toHaveCount(11);
  await expect(rows(page).nth(5)).toHaveAttribute('data-anchor', 'true');
  // Newest first: the closest newer document sits right above the anchor.
  await expect(rows(page).nth(4)).toContainText('Payment declined for order 75172');
  await expect(rows(page).nth(0)).toContainText('Timeout after 6550ms calling inventory');
  // Same timestamp as the anchor, ordered just below it by row id.
  await expect(rows(page).nth(6)).toContainText('Timeout after 3821ms calling inventory');
  await expect(rows(page).nth(9)).toContainText('Retrying request to auth (attempt 2)');
  await expect(rows(page).nth(10)).toContainText('Payment declined for order 56873');
  await expect(page.getByTestId('newer-status')).toHaveText('5 newer documents');
  await expect(page.getByTestId('older-status')).toHaveText('5 older documents');
});

test('Load [N] newer / older documents, with an editable step', async ({ page }) => {
  await openSurrounding(page);
  await page.getByRole('spinbutton', { name: 'Number of newer documents to load' }).fill('2');
  await page.getByTestId('load-newer').getByRole('button', { name: 'Load' }).click();
  await expect(page.getByTestId('newer-status')).toHaveText('7 newer documents');
  await expect(rows(page)).toHaveCount(13);
  await expect(rows(page).nth(7)).toHaveAttribute('data-anchor', 'true');
  // The two 09:01:00 documents, both now loaded in a stable order.
  await expect(rows(page).nth(0)).toContainText('Cache hit for key d1a409e3');
  await expect(rows(page).nth(1)).toContainText('Payment declined for order 44302');

  await page.getByTestId('load-older').getByRole('button', { name: 'Load' }).click();
  await expect(page.getByTestId('older-status')).toHaveText('10 older documents');
  await expect(rows(page)).toHaveCount(18);
});

test('IT-I: query dropped, filters carried over disabled, re-enabling one applies it', async ({ page }) => {
  await openSurrounding(page, { filters: JSON.stringify([paymentsPill]) });
  const url = new URL(page.url());
  expect(url.searchParams.get('q')).toBeNull();
  const pills = page.getByTestId('filter-pills');
  await expect(pills.getByRole('button', { name: /^Filter actions: ServiceName = payments/ })).toHaveAccessibleName(
    /\(disabled\)$/
  );
  // Disabled filter: neighbours from every service (inventory at 09:00:45).
  await expect(rows(page).nth(2)).toContainText('Payment declined for order 46162');
  await expect(rows(page)).toHaveCount(11);

  await pills.getByRole('button', { name: /^Filter actions: ServiceName = payments/ }).click();
  await page.getByRole('menu', { name: 'Filter actions' }).getByRole('button', { name: 'Re-enable' }).click();
  await expect(pills.getByRole('button', { name: /^Filter actions: ServiceName = payments/ })).not.toHaveAccessibleName(
    /\(disabled\)$/
  );
  // Only payments now: the inventory row is gone, 09:01:00 payments 44302 moves in.
  await expect(page.getByRole('grid')).not.toContainText('Payment declined for order 46162');
  await expect(rows(page).nth(0)).toContainText('Payment declined for order 44302');
  await expect(rows(page)).toHaveCount(11);
});

test('breadcrumb returns to Discover with the original query and filters', async ({ page }) => {
  const logs = await openSurrounding(page, { filters: JSON.stringify([paymentsPill]) });
  await page
    .getByRole('navigation', { name: 'Breadcrumb', exact: true })
    .getByRole('link', { name: 'Discover' })
    .click();
  await expect(logs.searchInput).toHaveValue(`"${ANCHOR_BODY}"`);
  await expect(logs.pill('ServiceName = payments')).not.toHaveAccessibleName(/\(disabled\)$/);
  await logs.expectRowCount(1);
});

test('a pinned filter arrives disabled and stays pinned (store untouched)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([paymentsPill]) });
  await page.evaluate(() => sessionStorage.removeItem('clickhouse-observe.pinnedFilters'));
  await logs.pillAction('ServiceName', 'Pin across pages');
  await openSurrounding(page, { filters: JSON.stringify([{ ...paymentsPill, pinned: true }]) });
  await expect(
    page.getByTestId('filter-pills').getByRole('button', { name: /^Filter actions: ServiceName = payments/ })
  ).toHaveAccessibleName(/\(pinned\) \(disabled\)$/);
  const stored = await page.evaluate(() => sessionStorage.getItem('clickhouse-observe.pinnedFilters'));
  expect(JSON.parse(stored!)).toHaveLength(1);
  expect(JSON.parse(stored!)[0].disabled).toBeUndefined();
  await page.evaluate(() => sessionStorage.removeItem('clickhouse-observe.pinnedFilters'));
});

test('IT-F: Discover columns are kept', async ({ page }) => {
  const cols = [
    { id: 'timestamp', key: '__timestamp', sqlExpr: 'Timestamp', displayName: 'Time', type: 'time', isCore: true },
    { id: 'body', key: '__body', sqlExpr: 'Body', displayName: 'Message', type: 'text', isCore: true },
    {
      id: 'map:LogAttributes:http.status_code',
      key: 'fld_map_LogAttributes_http_status_code',
      sqlExpr: "LogAttributes['http.status_code']",
      displayName: 'http.status_code',
      type: 'exact',
      isCore: false,
    },
  ];
  await openSurrounding(page, { cols: JSON.stringify(cols) });
  const headers = page.getByRole('grid').locator('thead th');
  await expect(headers.filter({ hasText: 'http.status_code' })).toHaveCount(1);
  await expect(headers.filter({ hasText: 'Service' })).toHaveCount(0);
  await expect(anchorRow(page)).toContainText('200');
});

test('re-anchor from a neighbour in the detail panel', async ({ page }) => {
  await openSurrounding(page);
  await rows(page).nth(4).getByRole('button', { name: 'Open detail' }).click();
  await page.getByRole('button', { name: 'View surrounding documents' }).click();
  await expect(anchorRow(page)).toContainText('Payment declined for order 75172');
  await expect(page.getByRole('heading', { name: /^Documents surrounding #\d+$/ })).not.toHaveText(
    `Documents surrounding #${ANCHOR_ID}`
  );
  await expect(rows(page).nth(6)).toContainText(ANCHOR_BODY);
});

test('malformed or unknown document links show an error, never a query', async ({ page }) => {
  const open = (path: string) => page.goto(`/a/${pluginJson.id}/context/${path}`, { waitUntil: 'domcontentloaded' });
  await open(`spec-fixture/${encodeURIComponent('1;DROP TABLE spec_logs_1')}`);
  await expect(page.getByText('Invalid document link')).toBeVisible({ timeout: 45_000 });
  await open('spec-fixture/1_1');
  await expect(page.getByText('Failed to load the anchor document')).toBeVisible({ timeout: 45_000 });
  await open('no-such-view/1_1');
  await expect(page.getByText('Data view not found')).toBeVisible({ timeout: 45_000 });
});
