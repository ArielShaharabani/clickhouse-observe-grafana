import { expect } from '@grafana/plugin-e2e';
import type { Page, Route } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// R5-TABS: a stuck Discover tab must not stall the next tab. Grafana's frontend runs
// at most 5 data queries at once (no HTTP/2); the stuck tab's queries are aborted when it unmounts.

const STUCK = 'payments';
const tabs = (page: Page) => page.getByRole('tablist', { name: 'Discover tabs' });

/** Hold every data query whose SQL mentions STUCK until the browser aborts it. */
async function holdStuckQueries(page: Page): Promise<{ held: () => number; aborted: () => number }> {
  let held = 0;
  let aborted = 0;
  await page.route('**/api/ds/query**', async (route: Route) => {
    if (!(route.request().postData() ?? '').includes(STUCK)) {
      return route.continue();
    }
    held++;
    // Never answered: the request stays open until the browser aborts it (requestfailed).
  });
  page.on('requestfailed', (req) => {
    if (req.url().includes('/api/ds/query') && (req.postData() ?? '').includes(STUCK)) {
      aborted++;
    }
  });
  return { held: () => held, aborted: () => aborted };
}

test('a stuck tab does not block a new tab, and switching away aborts its queries', async ({ page }) => {
  const logs = new LogsPage(page);
  const stuck = await holdStuckQueries(page);
  await logs.open({ q: `ServiceName:${STUCK}` });
  await expect.poll(stuck.held).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'New tab' }).click();
  await expect(tabs(page).getByRole('tab', { name: 'Untitled 2' })).toHaveAttribute('aria-selected', 'true');
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect.poll(stuck.aborted).toBeGreaterThan(0);
});

