import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// DISC-FILTER-02 filter builder (docs/spec/10-discover.md) + IT-B: pills built or edited with the
// builder re-query. Counts come from the deterministic fixture (docs/dev/TESTING.md).
// SeverityNumber: debug 5 (3,984), info 9 (28,265), warn 13 (6,080), error 17 (3,191).

const { total } = FIXTURE.counts;
const { info, warn, debug, error } = FIXTURE.counts.byLevel;

async function openBuilder(page: Page) {
  await page.getByRole('button', { name: 'Add filter' }).click();
}

async function pick(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name }).click();
  await page
    .getByRole('option', { name: new RegExp(`^${option}( |$)`) })
    .first()
    .click();
}

/** Type into a creatable Select / Combobox and commit with Enter (custom value). A multi select
 *  keeps its menu open after a pick and it would cover the form, so those blur with Tab. */
async function typeValue(page: Page, name: string, text: string, opts: { multi?: boolean } = {}) {
  const box = page.getByRole('combobox', { name, exact: true });
  await box.click();
  await box.fill(text);
  // The value list loads asynchronously; Enter while it is still loading selects nothing and leaves
  // the menu open over the form. Wait for an option to be offered first.
  await expect(page.getByRole('option').first()).toBeVisible();
  await box.press('Enter');
  if (opts.multi) {
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
  await build(page, 'ServiceName', 'is one of');
  await typeValue(page, 'Value', 'auth', { multi: true });
  await typeValue(page, 'Value', 'payments', { multi: true });
  await submit(page);
  await logs.expectRowCount(FIXTURE.counts.byService.auth + FIXTURE.counts.payments);

  await logs.open();
  await build(page, 'SeverityText', 'is not one of');
  await typeValue(page, 'Value', 'info', { multi: true });
  await typeValue(page, 'Value', 'debug', { multi: true });
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

test('a whole Map column gets no range operators', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openBuilder(page);
  await pick(page, 'Field', 'LogAttributes');
  await page.getByRole('combobox', { name: 'Operator' }).click();
  await expect(page.getByRole('option', { name: 'is', exact: true })).toBeVisible();
  for (const op of ['greater or equal', 'less than', 'is between', 'is not between']) {
    await expect(page.getByRole('option', { name: op, exact: true })).toHaveCount(0);
  }
});

test('invalid bounds are rejected in the form: not a number, From greater than To', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await openBuilder(page);
  await pick(page, 'Field', 'SeverityNumber');
  await pick(page, 'Operator', 'greater or equal');
  await typeValue(page, 'Value', '1s');
  await expect(page.getByTestId('filter-error')).toContainText('"1s" is not a number');
  await expect(page.getByRole('button', { name: 'Add filter', exact: true }).last()).toBeDisabled();

  await pick(page, 'Operator', 'is between');
  await typeValue(page, 'From', '13');
  await typeValue(page, 'To', '9');
  await expect(page.getByTestId('filter-error')).toHaveText('From must not be greater than To');
  await expect(page.getByRole('button', { name: 'Add filter', exact: true }).last()).toBeDisabled();
});

// Map keys are not listed in the builder's field picker (they are discovered on demand), so these
// pills come from a link; the pill menu (negate, ...) still works on them.
const durationKey = "LogAttributes['duration_ms']";
// duration_ms: 5..2004 for regular rows, 3000..7999 for the 1,200 incident rows.
const slow = 1200;

test('Map-key range pill from a link compares numerically; Exclude is the exact complement', async ({ page }) => {
  const logs = new LogsPage(page);
  const pill = { id: 'e2e-dur', field: durationKey, op: 'gte', value: '3000' };
  await logs.open({ filters: JSON.stringify([pill]) });
  await logs.expectRowCount(slow);
  await logs.pillAction('LogAttributes', 'Exclude results');
  await logs.expectRowCount(total - slow);
});

test('pills with a missing or non-numeric range bound match nothing and raise no error', async ({ page }) => {
  const logs = new LogsPage(page);
  for (const value of ['', '1s']) {
    const pill = { id: 'e2e-bad', field: 'SeverityNumber', op: 'gte', value };
    await logs.open({ filters: JSON.stringify([pill]) });
    await logs.expectRowCount(0);
    await expect(page.getByText(/Code: \d+|SYNTAX_ERROR|Cannot parse/)).toHaveCount(0);
  }
});
