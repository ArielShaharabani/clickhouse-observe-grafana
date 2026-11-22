import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// R5-SAMPLING (user item 15): budgeted full-time-range lookups beside the 500 / 5,000-row samples.
// Fixture fact: LogAttributes['duration_ms'] = '7505' occurs once, on 2026-01-05 (far outside the
// 500 newest rows), so only the full-range prefix lookup can suggest it.

test('value autocomplete finds a rare value outside the sample once a prefix is typed', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.searchInput.click();
  await logs.searchInput.pressSequentially('LogAttributes.duration_ms : 7505', { delay: 20 });
  await expect(logs.searchBar.getByRole('listbox').getByRole('option', { name: /"7505"/ })).toBeVisible();
});

test('Field statistics: Scan full range profiles every document and says it is complete', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByRole('radio', { name: 'Field statistics' }).click();
  await expect(page.getByText(/Calculated from 5,000 sample records/)).toBeVisible();
  await page.getByRole('button', { name: 'Scan full range' }).click();
  await expect(page.getByTestId('field-stats-scan-status')).toHaveText(
    `Scanned ${FIXTURE.counts.total.toLocaleString('en-US')} records over the full time range (complete).`
  );
  await expect(page.getByTestId('field-stats-row-SeverityText')).toContainText(
    `${FIXTURE.counts.total.toLocaleString('en-US')} (100%)`
  );
  await page.getByRole('button', { name: 'Back to sample' }).click();
  await expect(page.getByText(/Calculated from 5,000 sample records/)).toBeVisible();
});

test('field popover: Scan full range relabels the caption', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByTitle('ServiceName', { exact: true }).click(); // opens the field popover (disc-sidebar-02)
  await expect(page.getByText(/Calculated from 5,000 sample records/)).toBeVisible();
  await page.getByRole('button', { name: 'Scan full range' }).click();
  await expect(page.getByText(/^Scanned [\d,]+ records over the full time range \(complete\)\.$/)).toBeVisible();
});
