import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// IT-C (dirty query + time -> Update -> every panel refreshes) and
// IT-D (time writers: brush, filter-by-time, shift/zoom, typed shorthand -> URL time, interval).

const urlParams = (page: Page) => new URL(page.url()).searchParams;
const caption = (page: Page) => page.getByText(/rows \(count\) .*\(interval: /);
const histogramSvg = (page: Page) => page.locator('svg').filter({ has: page.locator('rect') }).first();

test('IT-C: a dirty query and a dirty time are both pending until their Update; then count, grid and histogram refresh', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);

  await logs.searchInput.fill('ServiceName : "payments"');
  await page.getByRole('textbox', { name: 'Time range shorthand' }).fill('-1h');
  const updateQuery = logs.searchBar.getByRole('button', { name: 'Update query' });
  const updateTime = page.getByRole('button', { name: 'Update time range' });
  await expect(updateQuery).toBeVisible();
  await expect(updateTime).toBeVisible();
  // Nothing ran yet: count, grid and URL still show the committed state.
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(logs.grid.getByRole('row').nth(1)).toBeVisible();
  expect(urlParams(page).get('from')).toBe(String(FIXTURE.from));

  // Time first: the committed window moves off the fixture; the query is still pending.
  await updateTime.click();
  await expect(logs.rowCount).toContainText('0 rows');
  await expect(updateTime).toHaveCount(0);
  await expect(updateQuery).toBeVisible();
  await expect(logs.grid.getByRole('row')).toHaveCount(0); // no rows
  // Query next: URL carries both, nothing pending.
  await updateQuery.click();
  await expect(updateQuery).toHaveCount(0);
  await expect.poll(() => urlParams(page).get('q')).toBe('ServiceName : "payments"');
  expect(urlParams(page).get('from')).toBe('now-1h');

  // Back on the fixture window the committed query is applied to every panel.
  await page.goto(page.url().replace(/from=[^&]*/, `from=${FIXTURE.from}`).replace(/to=[^&]*/, `to=${FIXTURE.to}`));
  await logs.expectRowCount(FIXTURE.counts.payments);
  await expect(logs.grid.getByRole('row').nth(1)).toContainText('payments');
});

test('IT-C: the Refresh button re-runs without changing the URL state', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'ServiceName : "payments"' });
  await logs.expectRowCount(FIXTURE.counts.payments);
  const before = page.url();
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await logs.expectRowCount(FIXTURE.counts.payments);
  expect(page.url()).toBe(before);
});

test('IT-D: brushing the histogram writes an absolute (epoch ms) window to the URL and recomputes the interval', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  const before = await caption(page).innerText();
  const svg = histogramSvg(page);
  const box = (await svg.boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.2, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.35, y, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => urlParams(page).get('from')).not.toBe(String(FIXTURE.from));
  const { from, to } = { from: Number(urlParams(page).get('from')), to: Number(urlParams(page).get('to')) };
  expect(Number.isInteger(from) && Number.isInteger(to)).toBe(true);
  expect(from).toBeGreaterThan(FIXTURE.from);
  expect(to).toBeLessThan(FIXTURE.to);
  expect(to - from).toBeLessThan(3 * 86_400_000);
  await expect(caption(page)).not.toHaveText(before);
  const intervalOf = (t: string) => /\(interval: ([^)]*)\)/.exec(t)![1];
  expect(intervalOf(await caption(page).innerText())).not.toBe(intervalOf(before));
  await expect(logs.rowCount).not.toContainText(`${FIXTURE.counts.total.toLocaleString('en-US')} rows`);
});

test('IT-D: Filter by time (bucket menu) narrows to the bucket and keeps an explicit interval', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ interval: 'day' });
  await logs.expectRowCount(FIXTURE.counts.total);
  const svg = histogramSvg(page);
  const box = (await svg.boundingBox())!;
  await svg.click({ button: 'right', position: { x: 2, y: box.height - 4 } });
  await page.getByRole('dialog', { name: 'Bucket actions' }).getByRole('button', { name: 'Filter by time' }).click();
  await expect.poll(() => urlParams(page).get('to')).toBe(String(FIXTURE.from + 86_400_000));
  expect(urlParams(page).get('from')).toBe(String(FIXTURE.from));
  expect(urlParams(page).get('interval')).toBe('day');
  // Inclusive end (as in Kibana): the day's 5,760 rows plus the row at exactly the next midnight.
  await logs.expectRowCount(5761);
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~1d');
});

test('IT-D: shift / zoom keep the interval param; typed shorthand writes relative time and survives reload', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ interval: 'day' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => urlParams(page).get('from')).toBe(String(FIXTURE.from - (FIXTURE.to - FIXTURE.from) / 2));
  expect(urlParams(page).get('interval')).toBe('day');
  await page.getByRole('textbox', { name: 'Time range shorthand' }).fill('-6h');
  await page.getByRole('textbox', { name: 'Time range shorthand' }).press('Enter');
  await expect.poll(() => urlParams(page).get('from')).toBe('now-6h');
  expect(urlParams(page).get('to')).toBe('now');
  expect(urlParams(page).get('interval')).toBe('day');
  await page.reload();
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~6h');
  expect(urlParams(page).get('from')).toBe('now-6h');
});
