import { expect } from '@grafana/plugin-e2e';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-SEARCH-02 KQL query bar with autocomplete (docs/spec/10-discover.md).

test('value suggestions appear quickly, quoted, and accepting one leaves the cursor after it', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await logs.searchInput.click();
  await logs.searchInput.pressSequentially('ServiceName : ', { delay: 20 });
  const started = Date.now();
  const firstValue = page.getByRole('listbox').getByRole('option').first();
  await expect(firstValue).toBeVisible();
  // Spec: ~300 ms after a typing pause. 250 ms debounce + a ClickHouse lookup; 2 s bound keeps the
  // check meaningful on the shared docker VM without being flaky.
  expect(Date.now() - started).toBeLessThan(2000);
  await expect(firstValue).toHaveText(/"(checkout|frontend|payments|inventory|auth)"/);

  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  const value = await logs.searchInput.inputValue();
  expect(value).toMatch(/^ServiceName : "(checkout|frontend|payments|inventory|auth)" $/);
  const cursor = await logs.searchInput.evaluate((el: HTMLInputElement) => el.selectionStart);
  expect(cursor).toBe(value.length);
});

test('an edited, uncommitted query shows Update; running it refreshes the results', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await expect(page.getByRole('button', { name: 'Update query' })).toHaveCount(0);
  await logs.searchInput.click();
  await logs.searchInput.fill('ServiceName : "payments"');
  const update = page.getByRole('button', { name: 'Update query' });
  await expect(update).toBeVisible();
  await logs.expectRowCount(FIXTURE.counts.total); // not run yet
  await update.click();
  await logs.expectRowCount(FIXTURE.counts.payments);
  await expect(update).toHaveCount(0);
});

test('matched query and filter terms are highlighted in result cells', async ({ page }) => {
  const errorPill = { id: 'e2e-error', field: 'SeverityText', op: '=', value: 'error' };
  const logs = new LogsPage(page);
  await logs.open({ q: 'declined', filters: JSON.stringify([errorPill]) });
  const marks = page.getByTestId('match-highlight');
  // Bare term → body column; filter value → level column.
  await expect(marks.filter({ hasText: /^declined$/i }).first()).toBeVisible();
  await expect(marks.filter({ hasText: /^error$/i }).first()).toBeVisible();
});
