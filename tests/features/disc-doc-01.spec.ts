import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-DOC-01 document detail flyout (docs/spec/10-discover.md).

async function openFirstDocument(page: Page, logs: LogsPage) {
  await logs.expectRowCount(FIXTURE.counts.total);
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  await expect(page.getByTestId('doc-field-row').first()).toBeVisible();
}

const rows = (page: Page) => page.getByTestId('doc-field-row');

test('pinned fields stick to the top across documents', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.evaluate(() => sessionStorage.removeItem('clickhouse-observe.pinnedDocFields'));
  await openFirstDocument(page, logs);
  const serviceRow = rows(page).filter({ has: page.getByTitle('ServiceName', { exact: true }) });
  await serviceRow.hover();
  await serviceRow.getByRole('button', { name: 'Pin field ServiceName' }).click();
  await expect(rows(page).first()).toContainText('ServiceName');
  await page.getByRole('button', { name: 'Next log' }).click();
  await expect(page.getByText(/^2 of /)).toBeVisible();
  await expect(rows(page).first()).toContainText('ServiceName');
  await expect(rows(page).first().getByLabel('Pinned')).toBeVisible();
});

test('first / last navigation and Hide null fields', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openFirstDocument(page, logs);
  const label = page.getByText(/^\d+ of \d+$/);
  const total = (await label.textContent())!.split(' of ')[1];
  await page.getByRole('button', { name: 'Last log on this page' }).click();
  await expect(label).toHaveText(`${total} of ${total}`);
  await page.getByRole('button', { name: 'First log on this page' }).click();
  await expect(label).toHaveText(`1 of ${total}`);

  // ScopeName is empty for every fixture row.
  await expect(rows(page).filter({ has: page.getByTitle('ScopeName', { exact: true }) })).toHaveCount(1);
  await page.getByText('Hide null fields').click();
  await expect(rows(page).filter({ has: page.getByTitle('ScopeName', { exact: true }) })).toHaveCount(0);
});

test('field-present action adds an exists filter (IT-A producer)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openFirstDocument(page, logs);
  const row = rows(page).filter({ has: page.getByTitle('ServiceName', { exact: true }) });
  await row.hover();
  await row.getByRole('button', { name: 'Filter to rows where ServiceName has any value' }).click();
  await expect(logs.filterBar.getByRole('button', { name: /^Filter actions: ServiceName exists/ })).toBeVisible();
  await logs.expectRowCount(FIXTURE.counts.total);
});
