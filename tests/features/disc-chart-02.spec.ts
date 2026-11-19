import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-CHART-02 histogram breakdown (docs/spec/10-discover.md): searchable field picker,
// "Breakdown by <field>" label, legend isolate / hide, legend ⋮ → Filter for / Filter out.

const SERVICES = ['payments', 'auth', 'checkout', 'frontend', 'inventory'];
const legend = (page: Page) => page.getByRole('list', { name: 'Histogram legend' });
const legendItem = (page: Page, value: string) =>
  legend(page).getByRole('button', { name: new RegExp(`^(hidden )?${value}$`) });

async function legendFilter(page: Page, value: string, action: 'Filter for' | 'Filter out') {
  await legendItem(page, value).hover();
  await page.getByRole('button', { name: `Legend actions for ${value}` }).click();
  const dialog = page.getByRole('dialog', { name: `Actions for ${value}` });
  await expect(dialog).toContainText(value);
  await dialog.getByRole('button', { name: new RegExp(`^${action}`) }).click();
  await expect(dialog).toBeHidden();
}

test('No breakdown → search and pick a field: label, URL and legend follow', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'none' });
  await logs.expectRowCount(FIXTURE.counts.total);
  const trigger = page.getByRole('button', { name: 'No breakdown' });
  await trigger.click();
  const picker = page.getByRole('dialog', { name: 'Breakdown field' });
  await picker.getByRole('textbox', { name: 'Search breakdown fields' }).fill('servicen');
  await picker.getByRole('button', { name: 'ServiceName' }).click();
  await expect(page.getByRole('button', { name: 'Breakdown by ServiceName' })).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get('bd')).toBe('field:col:ServiceName');
  for (const svc of SERVICES) {
    await expect(legendItem(page, svc)).toBeVisible();
  }
  // Escape closes the picker and changes nothing.
  await page.getByRole('button', { name: 'Breakdown by ServiceName' }).click();
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expect(page.getByRole('button', { name: 'Breakdown by ServiceName' })).toBeVisible();
});

test('legend: click isolates a series, ctrl+click hides one, the query is untouched', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'field:col:ServiceName' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await legendItem(page, 'auth').click();
  await expect(legendItem(page, 'auth')).toHaveAttribute('aria-pressed', 'true');
  for (const svc of SERVICES.filter((s) => s !== 'auth')) {
    await expect(legendItem(page, svc)).toHaveAttribute('aria-pressed', 'false');
  }
  await expect(legend(page).getByTestId('legend-hidden-icon')).toHaveCount(4);
  // Client-side view only: the result list keeps every row.
  await logs.expectRowCount(FIXTURE.counts.total);
  await legendItem(page, 'auth').click(); // show all again
  await expect(legend(page).getByTestId('legend-hidden-icon')).toHaveCount(0);
  await legendItem(page, 'payments').click({ modifiers: ['Control'] });
  await expect(legendItem(page, 'payments')).toHaveAttribute('aria-pressed', 'false');
  await expect(legendItem(page, 'auth')).toHaveAttribute('aria-pressed', 'true');
});

test('legend ⋮ → Filter for adds a pill (SHARED-ACTION-01); Filter out excludes the value', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'field:col:ServiceName' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await legendFilter(page, 'payments', 'Filter for');
  await logs.expectRowCount(FIXTURE.counts.payments);
  await expect(logs.pill('ServiceName')).toBeVisible();
  const filters = JSON.parse(new URL(page.url()).searchParams.get('filters') ?? '[]');
  expect(filters).toEqual([expect.objectContaining({ field: 'ServiceName', value: 'payments' })]);

  await logs.open({ bd: 'field:col:ServiceName' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await legendFilter(page, 'payments', 'Filter out');
  await logs.expectRowCount(FIXTURE.counts.total - FIXTURE.counts.payments);
});

test('IT: breakdown chosen from the field popover (DISC-SIDEBAR-02) drives label and legend actions', async ({
  page,
}) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'none' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await page.getByTitle('ServiceName', { exact: true }).click();
  await page.getByRole('button', { name: 'Break down histogram by ServiceName' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Breakdown by ServiceName' })).toBeVisible();
  await legendFilter(page, 'auth', 'Filter for');
  await logs.expectRowCount(FIXTURE.counts.byService.auth);
});

test('IT: severity breakdown legend filters by level', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open({ bd: 'severity' });
  await logs.expectRowCount(FIXTURE.counts.total);
  await expect(page.getByRole('button', { name: 'Breakdown by Severity' })).toBeVisible();
  await legendFilter(page, 'error', 'Filter for');
  await logs.expectRowCount(FIXTURE.counts.byLevel.error);
});
