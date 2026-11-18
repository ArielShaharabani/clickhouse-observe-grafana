import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-FILTER-02 filter builder (docs/spec/10-discover.md) + IT-B: pills built or edited with the
// builder re-query. Counts come from the deterministic fixture (docs/dev/TESTING.md).
// SeverityNumber: debug 5 (3,984), info 9 (28,265), warn 13 (6,080), error 17 (3,191).

test.describe.configure({ timeout: 60_000 }); // builder tests do several async lookups; avoid load-related flakes

const { total } = FIXTURE.counts;
const { info, warn, debug, error } = FIXTURE.counts.byLevel;

async function openBuilder(page: Page) {
  await page.getByRole('button', { name: 'Add filter' }).click();
}

async function pick(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name }).click();
  await page.getByRole('option', { name: new RegExp(`^${option}( |$)`) }).first().click();
}

/** Type into a creatable Select and commit with Enter (custom value). */
async function typeValue(page: Page, name: string, text: string) {
  const box = page.getByRole('combobox', { name, exact: true });
  await box.click();
  await box.fill(text);
  await box.press('Enter');
  // Single selects close their own menu on select; multi selects keep it open and it would cover
  // the rest of the form, so blur (Tab) only when it is still open after a moment.
  await page.waitForTimeout(300);
  if ((await box.getAttribute('aria-expanded')) === 'true') {
    await box.press('Tab');
  }
}

async function submit(page: Page, name = 'Add filter') {
  await page.getByRole('button', { name, exact: true }).last().click();
}

async function build(page: Page, field: string, op: string, value?: string) {
  await openBuilder(page);
  await pick(page, 'Field', field);
  await pick(page, 'Operator', op);
  if (value !== undefined) {
    await typeValue(page, 'Value', value);
  }
}

test('value input is disabled until an operator is picked; Add stays disabled until complete', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openBuilder(page);
  await expect(page.getByPlaceholder('Please select operator first...')).toBeDisabled();
  await pick(page, 'Field', 'SeverityNumber');
  await expect(page.getByPlaceholder('Please select operator first...')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add filter', exact: true }).last()).toBeDisabled();
  await pick(page, 'Operator', 'greater or equal');
  await expect(page.getByPlaceholder('Please select operator first...')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add filter', exact: true }).last()).toBeDisabled();
});

test('operator list depends on the field type', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openBuilder(page);
  await pick(page, 'Field', 'SeverityNumber');
  await page.getByRole('combobox', { name: 'Operator' }).click();
  await expect(page.getByRole('option', { name: 'is between', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'contains', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await pick(page, 'Field', 'ServiceName');
  await page.getByRole('combobox', { name: 'Operator' }).click();
  await expect(page.getByRole('option', { name: 'contains', exact: true })).toBeVisible();
  await expect(page.getByRole('option', { name: 'is between', exact: true })).toHaveCount(0);
});

test('is: a typed value filters; the preview shows the pill text', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'ServiceName', 'is', 'payments');
  await expect(page.getByTestId('filter-preview')).toContainText('ServiceName = payments');
  await submit(page);
  await logs.expectRowCount(FIXTURE.counts.payments);
  await expect(logs.pill('ServiceName = payments')).toBeVisible();
});

test('value autocomplete suggests real values from the shared service', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openBuilder(page);
  await pick(page, 'Field', 'SeverityText');
  await pick(page, 'Operator', 'is');
  await page.getByRole('combobox', { name: 'Value' }).click();
  for (const v of ['info', 'warn', 'debug', 'error']) {
    await expect(page.getByRole('option', { name: v, exact: true })).toBeVisible();
  }
  await page.getByRole('option', { name: 'error', exact: true }).click();
  await submit(page);
  await logs.expectRowCount(error);
});

test('is not', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'SeverityText', 'is not', 'error');
  await submit(page);
  await logs.expectRowCount(total - error);
});

test('is one of / is not one of', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'ServiceName', 'is one of', 'auth');
  await typeValue(page, 'Value', 'payments');
  await submit(page);
  await logs.expectRowCount(FIXTURE.counts.byService.auth + FIXTURE.counts.payments);

  await logs.open();
  await build(page, 'SeverityText', 'is not one of', 'info');
  await typeValue(page, 'Value', 'debug');
  await submit(page);
  await logs.expectRowCount(warn + error);
});

test('greater or equal / less than on a number field', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'SeverityNumber', 'greater or equal', '13');
  await submit(page);
  await logs.expectRowCount(warn + error);

  await logs.open();
  await build(page, 'SeverityNumber', 'less than', '9');
  await submit(page);
  await logs.expectRowCount(debug);
});

test('is between / is not between (inclusive bounds)', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openBuilder(page);
  await pick(page, 'Field', 'SeverityNumber');
  await pick(page, 'Operator', 'is between');
  await typeValue(page, 'From', '9');
  await typeValue(page, 'To', '13');
  await expect(page.getByTestId('filter-preview')).toContainText('SeverityNumber is between 9 and 13');
  await submit(page);
  await logs.expectRowCount(info + warn);

  await logs.open();
  await openBuilder(page);
  await pick(page, 'Field', 'SeverityNumber');
  await pick(page, 'Operator', 'is not between');
  await typeValue(page, 'From', '9');
  await typeValue(page, 'To', '13');
  await submit(page);
  await logs.expectRowCount(debug + error);
  await expect(logs.filterBar).toContainText('NOT');
});

test('exists / does not exist', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'ServiceName', 'exists');
  await expect(page.getByPlaceholder('Select or type a value…')).toHaveCount(0);
  await submit(page);
  await logs.expectRowCount(total);

  await logs.open();
  await build(page, 'ServiceName', 'does not exist');
  await submit(page);
  await logs.expectRowCount(0);
});

test('contains on a string field', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'SeverityText', 'contains', 'err');
  await submit(page);
  await logs.expectRowCount(error);
});

test('custom label replaces the pill text', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'SeverityText', 'is', 'error');
  await page.getByRole('textbox', { name: 'Custom label' }).fill('Only errors');
  await submit(page);
  await expect(logs.pill('Only errors')).toBeVisible();
  await logs.expectRowCount(error);
});

test('hostile value is data, not SQL: matches nothing and the page keeps working', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'ServiceName', 'is', "') OR 1=1 --");
  await submit(page);
  await logs.expectRowCount(0);
  await expect(page.getByText(/Code: \d+|SYNTAX_ERROR/)).toHaveCount(0);
});

test('IT-B: edit a builder-made pill (prefilled form, Update filter) re-queries', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'ServiceName', 'is', 'payments');
  await submit(page);
  await logs.expectRowCount(FIXTURE.counts.payments);

  await logs.pillAction('ServiceName', 'Edit filter');
  await expect(page.getByRole('button', { name: 'Update filter' })).toBeVisible();
  await expect(page.getByTestId('filter-preview')).toContainText('ServiceName = payments');
  await pick(page, 'Operator', 'is not');
  await typeValue(page, 'Value', 'payments');
  await submit(page, 'Update filter');
  await logs.expectRowCount(total - FIXTURE.counts.payments);
  await expect(logs.filterBar.getByRole('button', { name: /^Filter actions:/ })).toHaveCount(1);
});

test('IT-B: a builder-made range pill can be negated, disabled and deleted', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'SeverityNumber', 'greater or equal', '13');
  await submit(page);
  await logs.expectRowCount(warn + error);
  await logs.pillAction('SeverityNumber', 'Exclude results');
  await logs.expectRowCount(info + debug);
  await logs.pillAction('SeverityNumber', 'Temporarily disable');
  await logs.expectRowCount(total);
  await logs.pillAction('SeverityNumber', 'Re-enable');
  await logs.expectRowCount(info + debug);
  await logs.filterBar.getByRole('button', { name: /^Remove filter SeverityNumber/ }).click();
  await logs.expectRowCount(total);
});

test('Cancel closes the builder without adding a pill', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await build(page, 'SeverityText', 'is', 'error');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(logs.filterBar).toHaveCount(0);
  await logs.expectRowCount(total);
});
