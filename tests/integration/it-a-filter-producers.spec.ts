import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// IT-A: every filter producer writes a correct pill and every consumer re-queries.
// IT-M: the same actions, with the same names, everywhere (SHARED-ACTION-01 registry).

const { total, byLevel } = FIXTURE.counts;
const serviceCount = (svc: string) => (svc === 'payments' ? FIXTURE.counts.payments : 8064);

test('grid cell: Filter for adds the value as a pill and re-queries', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const cell = logs.grid.getByRole('cell').filter({ hasText: /^(checkout|frontend|payments|inventory|auth)$/ }).first();
  await cell.hover();
  const filterFor = logs.grid.getByRole('button', { name: /^Filter for Service: / });
  const name = (await filterFor.getAttribute('aria-label')) ?? '';
  const svc = name.replace('Filter for Service: ', '');
  await expect(logs.grid.getByRole('button', { name: /^Filter out Service: / })).toBeVisible();
  await expect(logs.grid.getByRole('button', { name: /^Copy value of Service$/ })).toBeVisible();
  await filterFor.click();
  await expect(logs.pill(`ServiceName = ${svc}`)).toBeVisible();
  await logs.expectRowCount(serviceCount(svc));
});

test('document drawer: Filter out excludes the value and re-queries', async ({ page }) => {
  const errorPill = { id: 'e2e-error', field: 'SeverityText', op: '=', value: 'error' };
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([errorPill]) });
  await logs.grid.getByRole('cell').nth(2).hover();
  await logs.grid.getByRole('button', { name: 'Open detail' }).first().click();
  const drawerAction = page.getByRole('button', { name: /^Filter out ServiceName: / }).first();
  const svc = ((await drawerAction.getAttribute('aria-label')) ?? '').replace('Filter out ServiceName: ', '');
  await drawerAction.click();
  await expect(logs.pill(`ServiceName ≠ ${svc}`)).toBeVisible();
  // errors in every service except `svc`
  await logs.expectRowCount(byLevel.error - FIXTURE.counts.errorsByService[svc]);
});

test('field list: exists / does-not-exist field filters', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  const traceRow = page.getByTitle('TraceId', { exact: true });
  await traceRow.hover();
  await traceRow.getByRole('button', { name: 'Filter for TraceId exists' }).click();
  await expect(logs.pill('TraceId exists')).toBeVisible();
  await logs.expectRowCount(total); // every fixture row has a trace id

  await traceRow.hover();
  await traceRow.getByRole('button', { name: 'Filter for TraceId does not exist' }).click();
  await expect(logs.pill('TraceId does not exist')).toBeVisible();
  await expect(logs.rowCount).toContainText('0 rows');
});

test('field stats popover: value actions use the same names as everywhere else', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByTitle('SeverityText', { exact: true }).click();
  const filterFor = page.getByRole('button', { name: 'Filter for SeverityText: error' });
  await expect(filterFor).toHaveAttribute('title', 'Filter for value');
  await filterFor.click();
  await expect(logs.pill('SeverityText = error')).toBeVisible();
  await logs.expectRowCount(byLevel.error);
});
