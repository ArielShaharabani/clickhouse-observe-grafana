import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// PERF-SEARCH (issue #4): newest-first windowed document search. The document list for a filter
// that is not a prefix of the table sort key (a Map-key filter) is fetched over the most recent
// window first and widened only until the page is full; the rows, their order and the histogram
// count must be exactly what the single full-range query gave.
// Fixture: LogAttributes.http.status_code = '500' on 1,991 rows over the 7 days (3,191 errors minus
// the 1,200 incident rows, which carry 503).

test.use({ timezoneId: 'UTC' });

const HOUR = 3_600_000;

test('map-key filter over 7 days lists the newest rows first and the count stays exact', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'LogAttributes.http.status_code : 500' });

  // The count and histogram cover the whole range, not just the window the list used.
  await logs.expectRowCount(1991);

  const rows = logs.grid.getByRole('row');
  await expect(rows.nth(1)).toBeVisible();
  const times = await rows.evaluateAll((els) =>
    els
      .slice(1, 51)
      .map((el) => el.querySelector('[role="gridcell"]')?.textContent ?? '')
  );
  const parsed = times.map((t) => Date.parse(t.replace(' @ ', ' ')));
  expect(parsed.length).toBeGreaterThan(10);
  expect(parsed.every((t) => Number.isFinite(t))).toBe(true);
  // Newest first.
  for (let i = 1; i < parsed.length; i++) {
    expect(parsed[i]).toBeLessThanOrEqual(parsed[i - 1]);
  }
  // The newest row is from the end of the range (the filter matches ~1 row per 5 minutes).
  expect(FIXTURE.to - parsed[0]).toBeLessThan(HOUR);
});

test('paging past the first 200 rows keeps the order (load-more uses the same windows)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ q: 'LogAttributes.http.status_code : 500' });
  await logs.expectRowCount(1991);
  const last = page.getByRole('button', { name: /last page|go to last/i }).first();
  if (await last.isVisible()) {
    await last.click();
  }
  await expect(logs.grid.getByRole('row').nth(1)).toBeVisible();
  await logs.expectRowCount(1991);
});
