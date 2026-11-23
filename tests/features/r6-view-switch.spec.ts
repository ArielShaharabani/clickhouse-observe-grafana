import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// Round 6 #1: what was discovered on one data view (auto-detected prune column, field index) must
// never reach queries on the next one, however slow that view's own discovery is.

const view = (id: string, name: string, logsTable: string, columns: object) => ({
  id,
  name,
  origin: 'personal',
  createdAt: '2026-01-01T00:00:00Z',
  datasourceUid: 'clickhouse-dev',
  database: 'default',
  logsTable,
  isOtel: false,
  sequentialConsistency: false,
  columns: { body: '', severity: '', traceId: '', serviceName: '', spanAttributes: '', partitionTimestamp: '', ...columns },
});
const VIEWS = [
  view('r6-spec', 'R6 spec', 'spec_logs', { timestamp: 'Timestamp', body: 'Body', serviceName: 'ServiceName' }),
  view('r6-noisy', 'R6 noisy', 'eval_noisy', { timestamp: 'event_time', body: 'body', serviceName: 'service' }),
];
const RANGE = { from: String(Date.UTC(2026, 0, 1)), to: String(Date.UTC(2026, 11, 31)) };
const pill = [{ id: 'f1', field: 'ServiceName', op: '=', value: 'checkout' }];

/** Seeds the views, slows eval_noisy's column lookup, and collects failed queries. */
async function setup(page: Page): Promise<string[]> {
  const errors: string[] = [];
  await page.addInitScript((v) => {
    try {
      window.localStorage.setItem('poortuna-clickhouse-observe:data-views', JSON.stringify(v));
    } catch {
      // Opaque-origin frames have no storage.
    }
  }, VIEWS);
  await page.route('**/api/ds/query**', async (route) => {
    const body = route.request().postData() ?? '';
    if (body.includes('system.columns') && body.includes('eval_noisy')) {
      await new Promise((r) => setTimeout(r, 2500));
    }
    await route.continue();
  });
  page.on('response', async (r) => {
    if (r.url().includes('/api/ds/query') && r.status() >= 400) {
      errors.push((await r.text().catch(() => '')).slice(0, 300));
    }
  });
  return errors;
}

async function pickView(page: Page, name: string) {
  await page.getByRole('button', { name: /^Data view/ }).click();
  await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
}

test('Discover: switching views with a filter runs no query with the old view columns', async ({ page }) => {
  const errors = await setup(page);
  const logs = new LogsPage(page);
  await logs.open({ ds: 'r6-spec', ...RANGE, filters: JSON.stringify(pill) });
  await logs.expectRowCount(8064);

  await pickView(page, 'R6 noisy');
  await expect(page.getByText(/^20 (rows loaded|of 20 loaded)/)).toBeVisible();
  await page.waitForTimeout(4000);
  await expect(page.getByText('Query error:')).toHaveCount(0);

  await pickView(page, 'R6 spec');
  await logs.expectRowCount(41520);
  expect(errors).toEqual([]);
});

test('Discover: a refused query and its error do not follow to the next view', async ({ page }) => {
  await setup(page);
  const logs = new LogsPage(page);
  await logs.open({ ds: 'r6-spec', ...RANGE });
  await logs.expectRowCount(41520);
  await logs.searchInput.fill('ServiceName:(');
  await logs.searchInput.press('Escape');
  await logs.searchInput.press('Enter');
  await expect(page.getByTestId('histogram-invalid-query')).toBeVisible();

  await pickView(page, 'R6 noisy');
  await expect(page.getByTestId('histogram-invalid-query')).toHaveCount(0);
  await expect(logs.searchInput).toHaveValue('');
});

test('Visualize: switching views with a filter runs no query with the old view columns', async ({ page }) => {
  const errors = await setup(page);
  const viz = new VisualizePage(page);
  await viz.open({ ds: 'r6-spec', ...RANGE, q: 'ServiceName:checkout', filters: JSON.stringify(pill) });
  await viz.addField('Timestamp');
  await expect(viz.chart).toBeVisible();

  await pickView(page, 'R6 noisy');
  await page.waitForTimeout(5000);
  await page.getByRole('button', { name: /^Remove filter/ }).click();
  await page.waitForTimeout(1500);
  expect(errors).toEqual([]);
});
