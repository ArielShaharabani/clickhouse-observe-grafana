import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// DISC-SIDEBAR-02 field statistics popover (docs/spec/10-discover.md).
// Expected numbers: the 5,000 most recent rows of the fixture (see docs/dev/TESTING.md).

async function openFieldStats(page: Page, field: string) {
  await page.getByTitle(field, { exact: true }).click();
}

test('keyword field: top values with percentages from a 5,000-record sample', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openFieldStats(page, 'SeverityText');
  await expect(page.getByText('Calculated from 5,000 sample records.')).toBeVisible();
  for (const [value, pct] of [
    ['info', '69.7%'],
    ['warn', '15.8%'],
    ['debug', '9.7%'],
    ['error', '4.8%'],
  ]) {
    await expect(page.getByRole('button', { name: `Filter for SeverityText: ${value}` })).toBeVisible();
    await expect(page.getByText(pct, { exact: true })).toBeVisible();
  }
});

test('stats reflect the current filters (IT-A consumer)', async ({ page }) => {
  const payments = { id: 'e2e-payments', field: 'ServiceName', op: '=', value: 'payments' };
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([payments]) });
  await openFieldStats(page, 'SeverityText');
  await expect(page.getByText('27.4%', { exact: true })).toBeVisible(); // payments errors in the sample
  await expect(page.getByText('53.3%', { exact: true })).toBeVisible();
});

test('numeric field: distribution toggle shows min / median / max and buckets', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openFieldStats(page, 'SeverityNumber');
  await page.getByRole('radio', { name: 'Distribution' }).click();
  const dist = page.getByTestId('numeric-distribution');
  await expect(dist.getByText('min 5')).toBeVisible();
  await expect(dist.getByText('median 9')).toBeVisible();
  await expect(dist.getByText('max 17')).toBeVisible();
  await expect(dist.getByLabel(/: 3483 records$/)).toBeVisible(); // info (9) bucket
  await expect(dist.getByText('Calculated from 5,000 sample records.')).toBeVisible();
});

test('break down the histogram by a field from its popover', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openFieldStats(page, 'ServiceName');
  await page.getByRole('button', { name: 'Break down histogram by ServiceName' }).click();
  await expect(page.getByRole('button', { name: /ServiceName/ }).filter({ hasText: 'ServiceName' }).first()).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('bd')).toBe('field:col:ServiceName');
  await expect(page.getByText('checkout', { exact: true }).first()).toBeVisible();
});

test('a field without values says so', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openFieldStats(page, 'ScopeName');
  await expect(page.getByText('No field data for the current search')).toBeVisible();
});
