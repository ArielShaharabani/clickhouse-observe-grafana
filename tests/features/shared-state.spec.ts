import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// SHARED-STATE-01/02 (docs/spec/30-shared.md): one search context, carried by the URL, with
// pinned filters following the user to pages opened without them.

const errorPill = { id: 'e2e-error', field: 'SeverityText', op: '=', value: 'error' };
const paymentsPill = { id: 'e2e-payments', field: 'ServiceName', op: '=', value: 'payments' };

test('filters, time and view in the URL reproduce the same result after a reload', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill, paymentsPill]) });
  await logs.expectRowCount(FIXTURE.counts.paymentsErrors);
  await page.reload();
  await logs.expectRowCount(FIXTURE.counts.paymentsErrors);
  const url = new URL(page.url());
  expect(url.searchParams.get('ds')).toBe(FIXTURE.dataViewId);
  expect(url.searchParams.get('from')).toBe(String(FIXTURE.from));
  expect(JSON.parse(url.searchParams.get('filters') ?? '[]')).toHaveLength(2);
});

test('interval and field breakdown come from the URL and stay in it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ interval: 'day', bd: 'field:col:ServiceName' });
  // Breakdown by service: the legend lists the fixture's five services.
  for (const svc of ['checkout', 'frontend', 'payments', 'inventory', 'auth']) {
    await expect(page.getByText(svc, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Day interval' })).toBeVisible();
  await expect(page.getByText(/interval: Day/)).toBeVisible();
  const url = new URL(page.url());
  expect(url.searchParams.get('interval')).toBe('day');
  expect(url.searchParams.get('bd')).toBe('field:col:ServiceName');
});

const seedPinnedStore = (p: object) => {
  window.sessionStorage.setItem('clickhouse-observe.pinnedFilters', JSON.stringify([p]));
};

test("a link that carries filters ignores the recipient's pinned filters", async ({ page }) => {
  await page.addInitScript(seedPinnedStore, { ...errorPill, pinned: true });
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([paymentsPill]) });
  // payments only, not payments AND error.
  await logs.expectRowCount(FIXTURE.counts.payments);
  expect(JSON.parse(new URL(page.url()).searchParams.get('filters') ?? '[]')).toHaveLength(1);
});

test('a pinned filter is applied to a page opened without it', async ({ page }) => {
  await page.addInitScript(seedPinnedStore, { ...errorPill, pinned: true });
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);
  const filters = JSON.parse(new URL(page.url()).searchParams.get('filters') ?? '[]');
  expect(filters).toEqual([expect.objectContaining({ field: 'SeverityText', value: 'error', pinned: true })]);
});
