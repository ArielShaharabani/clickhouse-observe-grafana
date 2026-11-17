import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-CHART-01 hits histogram (docs/spec/10-discover.md): caption, right-click actions.

test('caption shows the absolute range and the auto interval', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByText(/2026 @ \d\d:\d\d:\d\d\.\d{3} - .*2026 @ .*\(interval: Auto - (?!Auto)/)).toBeVisible();
});

test('right-click a bucket: filter the selected series (severity breakdown → one_of pill)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'severity' });
  await logs.expectRowCount(FIXTURE.counts.total);
  const svg = page.locator('svg').filter({ has: page.locator('rect') }).first();
  const box = (await svg.boundingBox())!;
  await svg.hover({ position: { x: box.width / 2, y: box.height - 4 } });
  await expect(page.getByText('Right-click to show actions')).toBeVisible();
  await svg.click({ button: 'right', position: { x: box.width / 2, y: box.height - 4 } });
  const dialog = page.getByRole('dialog', { name: 'Bucket actions' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Select series error' }).check({ force: true });
  await dialog.getByRole('checkbox', { name: 'Select series warn' }).check({ force: true });
  await dialog.getByRole('button', { name: 'Filter 2 selected series' }).click();
  await expect(dialog).toBeHidden();
  await logs.expectRowCount(FIXTURE.counts.byLevel.error + FIXTURE.counts.byLevel.warn);
});

test('right-click a bucket: Filter by time zooms to that bucket', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ interval: 'day' });
  await logs.expectRowCount(FIXTURE.counts.total);
  const svg = page.locator('svg').filter({ has: page.locator('rect') }).first();
  const box = (await svg.boundingBox())!;
  await svg.click({ button: 'right', position: { x: 2, y: box.height - 4 } });
  await page.getByRole('dialog', { name: 'Bucket actions' }).getByRole('button', { name: 'Filter by time' }).click();
  // First daily bucket of the fixture (2026-01-01 UTC): 1/7 of the base rows.
  await expect.poll(() => new URL(page.url()).searchParams.get('to')).toBe(String(FIXTURE.from + 86_400_000));
  await logs.expectRowCount(5760);
});
