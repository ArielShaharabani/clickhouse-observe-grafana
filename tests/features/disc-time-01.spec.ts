import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-TIME-01 time picker (shorthand, duration badge, shift, zoom out) and DISC-TIME-02 Update state
// (docs/spec/10-discover.md).

const DAY = 86_400_000;
const urlTime = (page: Page) => {
  const p = new URL(page.url()).searchParams;
  return { from: p.get('from'), to: p.get('to') };
};
const shorthand = (page: Page) => page.getByRole('textbox', { name: 'Time range shorthand' });
const updateTime = (page: Page) => page.getByRole('button', { name: 'Update time range' });

test('the duration badge shows the length of the window (fixture: ~7d)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~7d');
});

test('typing -3h applies a relative range: URL keeps now-3h, badge ~3h, fixture rows fall outside', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await shorthand(page).fill('-3h');
  await shorthand(page).press('Enter');
  await expect.poll(() => urlTime(page)).toEqual({ from: 'now-3h', to: 'now' });
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~3h');
  await expect(logs.rowCount).toContainText('0 rows');
  await expect(shorthand(page)).toHaveValue('');
});

test('td and yd write whole-day relative ranges', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await shorthand(page).fill('td');
  await shorthand(page).press('Enter');
  await expect.poll(() => urlTime(page)).toEqual({ from: 'now/d', to: 'now/d' });
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~1d');
  await shorthand(page).fill('yd');
  await shorthand(page).press('Enter');
  await expect.poll(() => urlTime(page)).toEqual({ from: 'now-1d/d', to: 'now-1d/d' });
});

test('invalid shorthand is flagged and leaves the range untouched', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await shorthand(page).fill('soon');
  await shorthand(page).press('Enter');
  await expect(shorthand(page)).toHaveAttribute('aria-invalid', 'true');
  expect(urlTime(page)).toEqual({ from: String(FIXTURE.from), to: String(FIXTURE.to) });
  await logs.expectRowCount(FIXTURE.counts.total);
});

test('Update state: typed shorthand is pending (Update shown, nothing re-run) until applied', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await expect(updateTime(page)).toHaveCount(0);
  await shorthand(page).fill('-1h');
  await expect(updateTime(page)).toBeVisible();
  await logs.expectRowCount(FIXTURE.counts.total);
  expect(urlTime(page)).toEqual({ from: String(FIXTURE.from), to: String(FIXTURE.to) });
  await updateTime(page).click();
  await expect(logs.rowCount).toContainText('0 rows');
  await expect(updateTime(page)).toHaveCount(0);
});

test('previous / next shift the window by its own length; zoom out doubles it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  const week = FIXTURE.to - FIXTURE.from;
  await page.getByRole('button', { name: 'Move time range backwards' }).click();
  await expect.poll(() => urlTime(page)).toEqual({ from: String(FIXTURE.from - week), to: String(FIXTURE.from) });
  await expect(logs.rowCount).toContainText('0 rows');
  await page.getByRole('button', { name: 'Move time range forwards' }).click();
  await expect.poll(() => urlTime(page)).toEqual({ from: String(FIXTURE.from), to: String(FIXTURE.to) });
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByRole('button', { name: 'Zoom out' }).click();
  await expect.poll(() => urlTime(page)).toEqual({
    from: String(FIXTURE.from - week / 2),
    to: String(FIXTURE.to + week / 2),
  });
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~14d');
  await logs.expectRowCount(FIXTURE.counts.total);
});

test('a range link with ISO-8601 from/to opens the same window', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z' });
  await logs.expectRowCount(5760);
  await expect(page.getByTestId('time-duration-badge')).toHaveText('~1d');
});
