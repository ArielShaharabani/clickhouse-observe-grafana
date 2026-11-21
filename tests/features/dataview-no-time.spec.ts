import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { VisualizePage } from '../pages/VisualizePage';

// A data view without a time field (docs/spec/30-shared.md): no time range anywhere, so Discover
// hides the histogram and time picker and Visualize hides its time picker too.

const VIEWS_KEY = 'poortuna-clickhouse-observe:data-views';
const NO_TIME_VIEW = {
  id: 'no-time',
  name: 'No time',
  origin: 'personal',
  createdAt: '2026-01-01T00:00:00Z',
  datasourceUid: 'clickhouse-dev',
  database: 'default',
  logsTable: 'spec_logs',
  isOtel: false,
  sequentialConsistency: false,
  columns: {
    timestamp: '',
    body: 'Body',
    severity: 'SeverityText',
    traceId: 'TraceId',
    serviceName: 'ServiceName',
    spanAttributes: '',
    partitionTimestamp: '',
  },
};

async function seedView(page: Page) {
  await page.addInitScript(
    ([key, view]) => {
      if (!sessionStorage.getItem('no-time-seeded')) {
        localStorage.setItem(key as string, JSON.stringify([view]));
        sessionStorage.setItem('no-time-seeded', '1');
      }
    },
    [VIEWS_KEY, NO_TIME_VIEW] as const
  );
}

const timePicker = (page: Page) => page.getByRole('button', { name: /Time range selected/ });

test('Discover and Visualize hide the time controls for a view without a time field', async ({ page }) => {
  // With a time field, both pages show the time picker (guards the locator).
  const logs = new LogsPage(page);
  await logs.open();
  await expect(timePicker(page)).toBeVisible();

  await seedView(page);
  await logs.open({ ds: NO_TIME_VIEW.id });
  await expect(logs.grid.getByRole('button', { name: 'Open detail' }).first()).toBeVisible({ timeout: 30_000 });
  await expect(timePicker(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /histogram/i })).toHaveCount(0);

  const viz = new VisualizePage(page);
  await viz.open({ ds: NO_TIME_VIEW.id });
  await expect(timePicker(page)).toHaveCount(0);
});
