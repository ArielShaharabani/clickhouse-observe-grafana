import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

test('logs page loads the fixture view with the exact total row count', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.expectRowCount(FIXTURE.counts.total);
});

for (const path of ['does-not-exist', 'deeper/unknown/path']) {
  test(`unknown app path "${path}" redirects to the logs page and keeps the query string`, async ({ page }) => {
    const logs = new LogsPage(page);
    const qs = new URLSearchParams({ ds: FIXTURE.dataViewId, from: String(FIXTURE.from), to: String(FIXTURE.to) });
    await page.goto(`/a/poortuna-clickhouse-observe-app/${path}?${qs}`);
    await page.waitForURL(/\/a\/poortuna-clickhouse-observe-app\/logs\?/);
    await logs.expectRowCount(FIXTURE.counts.total);
  });
}
