import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';

// SHARED-AUTOCOMPLETE-01 (docs/spec/30-shared.md): field suggestions show their type; value
// suggestions come from real data scoped to the current time range and filters.

test('field prefix suggests matching fields with their data type', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.searchInput.click();
  await logs.searchInput.pressSequentially('Servi', { delay: 40 });
  const options = page.getByRole('listbox').getByRole('option');
  await expect(options.filter({ hasText: 'ServiceName' }).first()).toBeVisible();
  // Kind badge ("field") and the field's data type ("string", ServiceName is LowCardinality(String)).
  await expect(options.filter({ hasText: 'ServiceName' }).first()).toContainText('field');
  await expect(options.filter({ hasText: 'ServiceName' }).first()).toContainText('string');
});

test('value suggestions are scoped by the active filters', async ({ page }) => {
  // Only the incident rows carry http.status_code 503, and they all belong to payments.
  const only503 = { id: 'e2e-503', field: "LogAttributes['http.status_code']", op: '=', value: '503' };
  const logs = new LogsPage(page);
  await logs.open({ filters: JSON.stringify([only503]) });
  await logs.expectRowCount(1200);
  await logs.searchInput.click();
  await logs.searchInput.pressSequentially('ServiceName : ', { delay: 40 });
  const values = page.getByRole('listbox').getByRole('option');
  await expect(values.filter({ hasText: 'payments' }).first()).toBeVisible();
  await expect(values.filter({ hasText: 'checkout' })).toHaveCount(0);
  await expect(values.filter({ hasText: 'frontend' })).toHaveCount(0);
});
