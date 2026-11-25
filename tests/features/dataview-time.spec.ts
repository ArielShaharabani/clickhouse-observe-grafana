import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// PLAN #16d — data view time field: epoch / text time columns read through a conversion
// (default.spec_logs_epoch, scripts/clickhouse-init/05_dataview_time_fixture.sql: the spec_logs
// rows with the time stored as ts_s / ts_ms / ts_ns numbers and ts_text ISO strings).

const VIEWS_KEY = 'poortuna-clickhouse-observe:data-views';

const epochView = (id: string, timestamp: string, timestampFormat: string) => ({
  id,
  name: `Epoch ${timestamp}`,
  origin: 'personal',
  createdAt: '2026-01-01T00:00:00Z',
  datasourceUid: 'clickhouse-dev',
  database: 'default',
  logsTable: 'spec_logs_epoch',
  isOtel: false,
  sequentialConsistency: false,
  timestampFormat,
  columns: {
    timestamp,
    body: 'Body',
    severity: 'SeverityText',
    traceId: 'TraceId',
    serviceName: 'ServiceName',
    spanAttributes: '',
    partitionTimestamp: '',
  },
});

const VIEWS = [
  epochView('epoch-s', 'ts_s', 'epoch_s'),
  epochView('epoch-ms', 'ts_ms', 'epoch_ms'),
  epochView('epoch-ns', 'ts_ns', 'epoch_ns'),
  epochView('epoch-text', 'ts_text', 'string'),
];

async function seedViews(page: Page) {
  await page.addInitScript(
    ([key, views]) => {
      if (!sessionStorage.getItem('dataview-time-seeded')) {
        localStorage.setItem(key as string, JSON.stringify(views));
        sessionStorage.setItem('dataview-time-seeded', '1');
      }
    },
    [VIEWS_KEY, VIEWS] as const
  );
}

for (const v of VIEWS) {
  test(`converted time field ${v.timestampFormat}: the fixture range finds every row, level filter narrows`, async ({
    page,
  }) => {
    await seedViews(page);
    const logs = new LogsPage(page);
    await logs.open({ ds: v.id });
    await logs.expectRowCount(FIXTURE.counts.total);
    await logs.open({ ds: v.id, q: 'SeverityText:error' });
    await logs.expectRowCount(FIXTURE.counts.byLevel.error);
    // The Time column shows the converted time (fixture rows are in January 2026), not the raw number.
    await expect(logs.grid.getByText(/2026-01-0\d/).first()).toBeVisible();
  });
}

test('converted time field: a narrower window keeps only the incident hours', async ({ page }) => {
  await seedViews(page);
  const logs = new LogsPage(page);
  const native = new LogsPage(page);
  const incident = { from: String(FIXTURE.incident.from), to: String(FIXTURE.incident.to) };
  await native.open(incident);
  const nativeText = (await native.rowCount.textContent()) ?? '';
  await logs.open({ ds: 'epoch-ms', ...incident });
  await expect(logs.rowCount).toHaveText(nativeText);
});

test('edit a personal view: switch the time field, the epoch unit is guessed and saved', async ({ page }) => {
  await seedViews(page);
  const logs = new LogsPage(page);
  await logs.open({ ds: 'epoch-s' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByTitle(/^Switch data view/).click();
  await page.getByTitle('Edit data view').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByTestId('converted-time-note')).toContainText('Epoch seconds');
  await dialog.getByLabel('Timestamp field').click();
  await page.getByRole('option', { name: /^ts_ms/ }).click();
  // ts_ms holds 13-digit values: the sample read picks milliseconds.
  await expect(dialog.getByTestId('converted-time-note')).toContainText('Epoch milliseconds');
  await dialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(dialog).toBeHidden();
  await logs.expectRowCount(FIXTURE.counts.total);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '[]'), VIEWS_KEY);
  const edited = stored.find((s: { id: string }) => s.id === 'epoch-s');
  expect(edited.columns.timestamp).toBe('ts_ms');
  expect(edited.timestampFormat).toBe('epoch_ms');
});

test('Configuration page: shared views use the same dialog as personal views', async ({ appConfigPage, page }) => {
  const card = page.locator('div').filter({ has: page.getByText('Spec fixture logs', { exact: true }) }).filter({
    has: page.getByRole('button', { name: 'Edit' }),
  });
  await card.last().getByRole('button', { name: 'Edit' }).click();
  const dialog = page.getByRole('dialog');
  // The time field is a native DateTime column: no conversion flagged.
  await expect(dialog.getByLabel('Timestamp field')).toBeVisible();
  await expect(dialog.getByTestId('converted-time-note')).toHaveCount(0);

  // The inferred partition / index column is not asked for.
  await dialog.getByRole('button', { name: /Advanced/ }).click();
  await dialog.getByRole('button', { name: /Column mapping/ }).click();
  await expect(dialog.getByText('Trace ID column')).toBeVisible();
  await expect(dialog.getByText(/Partition\/index/)).toHaveCount(0);

  // The timeout can be cleared and retyped.
  await dialog.getByRole('button', { name: /Query settings/ }).click();
  const timeout = dialog.getByPlaceholder('25');
  await timeout.fill('40');
  await timeout.fill('');
  await expect(timeout).toHaveValue('');

  // Apply keeps the edit on the page until the configuration is saved.
  await dialog.getByRole('button', { name: 'Apply' }).click();
  await expect(page.getByText('Data view changes are not saved yet')).toBeVisible();
  // Nothing saved: leaving the page discards the edit (other suites rely on the provisioned view).
});
