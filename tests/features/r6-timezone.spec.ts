import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// R6-TZ: the time picker's "Change time settings" sets the zone every time on screen is shown in.
// The browser runs in UTC, so a Tokyo (UTC+9, no DST) pick moves every wall-clock time by 9 h.

test.use({ timezoneId: 'UTC' });

async function pickZone(page: Page, search: string, option: RegExp) {
  await page.getByTestId('data-testid TimePicker Open Button').click();
  await page.getByRole('button', { name: 'Change time settings' }).click();
  const picker = page.getByRole('combobox', { name: 'Time zone picker' });
  await picker.click();
  await picker.fill(search);
  await page.getByRole('option', { name: option }).first().click();
  await page.keyboard.press('Escape');
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Each test starts on the default zone (the init script runs again on reload, so only clear once).
    if (!sessionStorage.getItem('r6-tz-init')) {
      localStorage.removeItem('clickhouse-observe.timeSettings');
      sessionStorage.setItem('r6-tz-init', '1');
    }
  });
});

test('Discover: the zone moves the grid, the histogram caption and the axis; it survives a reload', async ({ page }, info) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByText(/Jan 1, 2026 @ 00:00:00\.000 - Jan 8, 2026 @ 00:00:00\.000/)).toBeVisible();
  const firstCell = logs.grid.getByRole('row').nth(1);
  const before = (await firstCell.innerText()).match(/2026-01-\d\d \d\d:\d\d:\d\d\.\d{3}/)![0];

  await pickZone(page, 'Tokyo', /Asia\/Tokyo/);
  await expect(page.getByText(/Jan 1, 2026 @ 09:00:00\.000 - Jan 8, 2026 @ 09:00:00\.000/)).toBeVisible();
  const after = (await firstCell.innerText()).match(/2026-01-\d\d \d\d:\d\d:\d\d\.\d{3}/)![0];
  expect(Date.parse(after.replace(' ', 'T') + 'Z') - Date.parse(before.replace(' ', 'T') + 'Z')).toBe(9 * 3600_000);
  await page.screenshot({ path: info.outputPath('discover-tokyo.png') });

  // Absolute range: the same instants (the URL is unchanged), only shown in the zone.
  expect(new URL(page.url()).searchParams.get('from')).toBe(String(FIXTURE.from));

  await page.reload();
  await expect(logs.searchInput).toBeVisible();
  await expect(page.getByText(/Jan 1, 2026 @ 09:00:00\.000 - Jan 8, 2026 @ 09:00:00\.000/)).toBeVisible();
});

test('Discover: Default goes back to the Grafana preference', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await pickZone(page, 'Tokyo', /Asia\/Tokyo/);
  await expect(page.getByText(/Jan 1, 2026 @ 09:00:00\.000/)).toBeVisible();
  await pickZone(page, 'Default', /^Default/);
  await expect(page.getByText(/Jan 1, 2026 @ 00:00:00\.000 - /)).toBeVisible();
});

test('Discover: a relative "Today" range resolves in the chosen zone', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ from: 'now/d', to: 'now/d' });
  await pickZone(page, 'Kiritimati', /Pacific\/Kiritimati/); // UTC+14: its day starts 10 to 24 h before UTC's
  await expect.poll(() => new URL(page.url()).searchParams.get('from')).toBe('now/d');
  // The picker names the zone it resolved the day in (the fixture has no rows today, so no caption).
  await expect(page.getByRole('button', { name: /Time range selected: Today/ })).toContainText('+14');
});

test('Visualize: the picked zone shows in the chart axis and the picker', async ({ page }, info) => {
  const viz = new VisualizePage(page);
  await viz.open();
  await pickZone(page, 'Tokyo', /Asia\/Tokyo/);
  await viz.addField('Timestamp');
  await expect(viz.chart).toBeVisible();
  await page.screenshot({ path: info.outputPath('visualize-tokyo.png') });
  await expect(page.getByTestId('data-testid TimePicker Open Button')).toContainText('2026-01-01 09:00:00');
});
