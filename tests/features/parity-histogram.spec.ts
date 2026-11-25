import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// PARITY-HISTOGRAM: Kibana 9.5 parity for the Discover histogram and time
// (docs/spec/10-discover.md DISC-CHART-01, DISC-TIME-01; 30-shared.md SHARED-STATE-01/02).
// Fixture: one row every 15 s from 2026-01-01 00:00 UTC (rows at every whole hour and midnight),
// plus 1,200 payments rows on 2026-01-05 09:00–10:59:54.

// The fixture and the expected tick labels are UTC; Grafana shows the browser's zone.
test.use({ timezoneId: 'UTC' });

const H = 3_600_000;
const JAN5 = Date.UTC(2026, 0, 5);
const urlParams = (page: Page) => new URL(page.url()).searchParams;
const histogramSvg = (page: Page) =>
  page
    .locator('svg')
    .filter({ has: page.locator('rect') })
    .first();
const caption = (page: Page) => page.getByText(/rows \(count\) .*\(interval: /);

async function drag(page: Page, fromPct: number, toPct: number) {
  const box = (await histogramSvg(page).boundingBox())!;
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * fromPct, y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toPct, y, { steps: 5 });
  await page.mouse.up();
  return box;
}

test('brush uses the exact dragged times, not whole buckets (Kibana 07:43 → 11:48)', async ({ page }) => {
  const logs = new LogsPage(page);
  // 24 h, auto 30-minute buckets (48 bars, all whole). The range end is inclusive and the fixture
  // has a row exactly at midnight, so end one second early to keep that row from adding a 49th bar.
  await logs.open({ from: String(JAN5), to: String(JAN5 + 24 * H - 1000) });
  await expect(caption(page)).toContainText('Auto - 30 minutes');
  const box = await drag(page, 0.2, 0.6);
  await expect.poll(() => urlParams(page).get('from')).not.toBe(String(JAN5));
  const from = Number(urlParams(page).get('from'));
  const to = Number(urlParams(page).get('to'));
  // One pixel is 24 h / width; allow two pixels of slack around 04:48 and 14:24.
  const px = (24 * H) / box.width;
  expect(Math.abs(from - (JAN5 + 4.8 * H))).toBeLessThanOrEqual(2 * px + 1000);
  expect(Math.abs(to - (JAN5 + 14.4 * H))).toBeLessThanOrEqual(2 * px + 1000);
  // Not snapped to the 30-minute buckets (the old bug gave 04:30 / 14:00 style edges).
  expect(from % (30 * 60_000) !== 0 || to % (30 * 60_000) !== 0).toBe(true);
  // Whole seconds (the queried range is the one shown).
  expect(from % 1000).toBe(0);
  expect(to % 1000).toBe(0);
  // Re-bucketed for the new ~9.6 h range, and the edge buckets are shown as partial.
  await expect(caption(page)).toContainText('Auto - 10 minutes');
  await expect(page.getByTestId('histogram-partial-bucket').first()).toBeAttached();
});

test('a brush inside one bucket gives a non-empty range with rows, never from == to', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ from: String(JAN5), to: String(JAN5 + 24 * H) });
  await expect(caption(page)).toContainText('Auto - 30 minutes');
  // Bucket 5 of 48 spans 10.42 %–12.5 %: drag inside it.
  await drag(page, 0.107, 0.122);
  await expect.poll(() => urlParams(page).get('from')).not.toBe(String(JAN5));
  const from = Number(urlParams(page).get('from'));
  const to = Number(urlParams(page).get('to'));
  expect(to).toBeGreaterThan(from);
  expect(to - from).toBeLessThan(30 * 60_000);
  await expect(page.getByText('No events in selected time range')).toHaveCount(0);
  await expect(logs.rowCount).not.toContainText(/^0 rows/);
});

test('counts include the end second, like Kibana: 08:00–12:00 is 2,161 rows', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ from: '2026-01-05T08:00:00.000Z', to: '2026-01-05T12:00:00.000Z' });
  // 961 base rows (08:00:00 … 12:00:00 every 15 s) + 1,200 incident rows.
  await logs.expectRowCount(2161);
  // The row at exactly 12:00:00 sits in a bucket starting at the range end, shown as partial.
  await expect(page.getByTestId('histogram-partial-bucket')).toHaveCount(1);
  // The field popover counts the same window the same way.
  await page.getByTitle('ServiceName', { exact: true }).click();
  await expect(page.getByText(/2,161/).first()).toBeVisible();
});

test('auto-refresh is paused by default; a chosen interval is kept in the URL', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  expect(urlParams(page).get('refresh')).toBeNull();
  await expect(page.getByText('30s', { exact: true })).toHaveCount(0);

  await logs.open({ refresh: '1m' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByText('1m', { exact: true })).toBeVisible();
  expect(urlParams(page).get('refresh')).toBe('1m');

  // Junk is ignored and dropped from the URL.
  await logs.open({ refresh: '1s;DROP' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect.poll(() => urlParams(page).get('refresh')).toBeNull();
});

test('7 days: auto 3-hour buckets, day ticks "1st … 7th" with the month, no colliding labels', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(caption(page)).toContainText('(interval: Auto - 3 hours)');
  const axis = page.getByTestId('histogram-x-axis');
  await expect(axis).toContainText('1st');
  await expect(axis).toContainText('7th');
  await expect(axis).toContainText('January 2026');
  // Neighbouring tick labels never overlap.
  const ticks = axis.getByTestId('histogram-x-tick');
  const boxes = [];
  for (let i = 0; i < (await ticks.count()); i++) {
    boxes.push((await ticks.nth(i).boundingBox())!);
  }
  for (let i = 1; i < boxes.length; i++) {
    expect(boxes[i].x).toBeGreaterThanOrEqual(boxes[i - 1].x + boxes[i - 1].width);
  }
});

test('Minute on 7 days is scaled to 15 minutes with a visible notice; nothing in the picker is disabled', async ({
  page,
}) => {
  const logs = new LogsPage(page);
  await logs.open({ interval: 'minute' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(caption(page)).toContainText('(interval: Minute, scaled to 15 minutes)');
  await expect(page.getByTestId('histogram-interval-scaled')).toContainText('Scaled to 15 minutes');
  await page.getByRole('button', { name: 'Minute interval' }).click();
  const second = page.getByRole('button', { name: 'Second', exact: true });
  await expect(second).toBeEnabled();
  await second.click();
  await expect.poll(() => urlParams(page).get('interval')).toBe('second');
  await expect(page.getByTestId('histogram-interval-scaled')).toContainText('Scaled to 15 minutes');
  await logs.expectRowCount(FIXTURE.counts.total);
});

test('the axis date line never overlaps the row-count caption (detail panel open; no chart at 0 rows)', async ({
  page,
}) => {
  const logs = new LogsPage(page);
  const assertClear = async () => {
    const axis = (await page.getByTestId('histogram-x-axis').boundingBox())!;
    const cap = (await logs.rowCount.boundingBox())!;
    expect(axis.y + axis.height).toBeLessThanOrEqual(cap.y + 1);
  };
  // 0 rows: an empty week before the fixture. The empty state replaces the chart and its
  // caption (PARITY-FIELDS), so there is nothing left to overlap.
  await logs.open({ from: String(FIXTURE.from - 7 * 24 * H), to: String(FIXTURE.from - 1000) });
  await expect(page.getByText('No results match your search criteria')).toBeVisible();
  await expect(logs.rowCount).toHaveCount(0);
  await expect(page.getByTestId('histogram-x-axis')).toHaveCount(0);
  // Detail panel open (narrower chart).
  await logs.open({ from: String(JAN5 + 8 * H), to: String(JAN5 + 12 * H) });
  await logs.expectRowCount(2161);
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByTestId('doc-field-row').first()).toBeVisible();
  await assertClear();
});

test('default breakdown is "No breakdown" (Kibana); an explicit bd still wins', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByRole('button', { name: 'No breakdown' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Histogram legend' })).toHaveCount(0);
  expect(urlParams(page).get('bd')).toBeNull();

  await logs.open({ bd: 'severity' });
  await expect(page.getByRole('button', { name: 'Breakdown by Severity' })).toBeVisible();
});

test('a malformed bd param is normalised or dropped from the URL', async ({ page }) => {
  const logs = new LogsPage(page);
  // Missing the `col:` prefix: resolved to the column and rewritten canonically.
  await logs.open({ bd: 'field:ServiceName' });
  await expect(page.getByRole('button', { name: 'Breakdown by ServiceName' })).toBeVisible();
  await expect.poll(() => urlParams(page).get('bd')).toBe('field:col:ServiceName');

  // Unknown field: no breakdown, and the URL stops claiming one.
  await logs.open({ bd: 'field:NoSuchField' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByRole('button', { name: 'No breakdown' })).toBeVisible();
  await expect.poll(() => urlParams(page).get('bd')).toBeNull();
  // Round 2 #17: and it says so instead of dropping it silently.
  await expect(page.getByTestId('breakdown-notice')).toContainText('NoSuchField');

  // Junk value: same, with a notice that can be dismissed.
  await logs.open({ bd: 'whatever' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect.poll(() => urlParams(page).get('bd')).toBeNull();
  await expect(page.getByTestId('breakdown-notice')).toContainText('"whatever"');
  await page.getByRole('button', { name: 'Dismiss breakdown notice' }).click();
  await expect(page.getByTestId('breakdown-notice')).toHaveCount(0);
});
