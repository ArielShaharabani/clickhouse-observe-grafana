import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { LogsPage } from '../pages/LogsPage';
import { FIXTURE } from '../fixture';

// R2-FILTER-GROUPS: one filter pill built from several conditions combined with OR / AND
// (Kibana filter builder parity). Counts come from the deterministic fixture (docs/dev/TESTING.md).

const { total, byService, errorsByService } = FIXTURE.counts;

async function pick(page: Page, name: string, option: string) {
  await page.getByRole('combobox', { name, exact: true }).click();
  await page.getByRole('option', { name: new RegExp(`^${option}( |$)`) }).first().click();
}

async function typeValue(page: Page, name: string, text: string) {
  const box = page.getByRole('combobox', { name, exact: true });
  await box.click();
  await box.fill(text);
  await expect(page.getByRole('option').first()).toBeVisible();
  await box.press('Enter');
}

/** Fills one condition row; `row` is the accessible-name suffix ('' for a lone condition). */
async function condition(page: Page, row: string, field: string, op: string, value: string) {
  const sfx = row ? ` ${row}` : '';
  await pick(page, `Field${sfx}`, field);
  await pick(page, `Operator${sfx}`, op);
  await typeValue(page, `Value${sfx}`, value);
}

async function submit(page: Page, name = 'Add filter') {
  await page.getByRole('button', { name, exact: true }).last().click();
}

/** payments OR (auth AND SeverityNumber = 17): payments 9,264 + auth errors 384. */
const OR_OF_AND = byService.payments + errorsByService.auth;

async function buildOrOfAnd(page: Page) {
  await page.getByRole('button', { name: 'Add filter' }).click();
  await condition(page, '', 'ServiceName', 'is', 'payments');
  await page.getByRole('button', { name: 'Add OR condition' }).click();
  await condition(page, '#2', 'ServiceName', 'is', 'auth');
  await page.getByRole('button', { name: 'Add AND condition #2' }).click();
  await condition(page, '#2.2', 'SeverityNumber', 'is', '17');
}

test('OR of two conditions: one pill, readable label, live preview', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await condition(page, '', 'ServiceName', 'is', 'payments');
  await page.getByRole('button', { name: 'Add OR condition' }).click();
  await condition(page, '#2', 'ServiceName', 'is', 'auth');
  await expect(page.getByTestId('filter-preview')).toContainText('ServiceName = payments OR ServiceName = auth');
  await submit(page);
  await logs.expectRowCount(byService.payments + byService.auth);
  await expect(logs.filterBar.getByRole('button', { name: /^Filter actions:/ })).toHaveCount(1);
  await expect(logs.pill('ServiceName = payments OR ServiceName = auth')).toBeVisible();
});

test('OR of ANDs: nested group counts rows correctly', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await buildOrOfAnd(page);
  await expect(page.getByTestId('filter-condition-group')).toHaveCount(1);
  await expect(page.getByTestId('filter-preview')).toContainText(
    'ServiceName = payments OR (ServiceName = auth AND SeverityNumber = 17)'
  );
  await submit(page);
  await logs.expectRowCount(OR_OF_AND);
});

test('negate, disable and delete work on the whole compound pill', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await buildOrOfAnd(page);
  await submit(page);
  await logs.expectRowCount(OR_OF_AND);
  await logs.pillAction('ServiceName', 'Exclude results');
  await logs.expectRowCount(total - OR_OF_AND);
  await logs.pillAction('NOT', 'Temporarily disable');
  await logs.expectRowCount(total);
  await logs.pillAction('NOT', 'Re-enable');
  await logs.expectRowCount(total - OR_OF_AND);
  await logs.filterBar.getByRole('button', { name: /^Remove filter NOT/ }).click();
  await logs.expectRowCount(total);
});

test('the compound pill survives a reload from the URL', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await buildOrOfAnd(page);
  await submit(page);
  await logs.expectRowCount(OR_OF_AND);
  await page.reload();
  await logs.expectRowCount(OR_OF_AND);
  await expect(logs.pill('ServiceName = payments OR')).toBeVisible();
});

test('edit a compound pill: prefilled rows, remove a condition, collapses to a plain pill', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await condition(page, '', 'ServiceName', 'is', 'payments');
  await page.getByRole('button', { name: 'Add OR condition' }).click();
  await condition(page, '#2', 'ServiceName', 'is', 'auth');
  await submit(page);
  await logs.expectRowCount(byService.payments + byService.auth);

  await logs.pillAction('ServiceName', 'Edit filter');
  await expect(page.getByTestId('filter-condition')).toHaveCount(2);
  await expect(page.getByTestId('filter-preview')).toContainText('ServiceName = payments OR ServiceName = auth');
  await page.getByRole('button', { name: 'Delete condition #2' }).click();
  await expect(page.getByTestId('filter-condition')).toHaveCount(1);
  await submit(page, 'Update filter');
  await logs.expectRowCount(byService.payments);
  await expect(logs.pill('ServiceName = payments$')).toBeVisible();
});

test('hostile values inside a group are data, not SQL', async ({ page }) => {
  const logs = new LogsPage(page);
  await logs.open();
  await page.getByRole('button', { name: 'Add filter' }).click();
  await condition(page, '', 'ServiceName', 'is', "') OR 1=1 --");
  await page.getByRole('button', { name: 'Add OR condition' }).click();
  await condition(page, '#2', 'ServiceName', 'is', "x'; DROP TABLE t --");
  await submit(page);
  await logs.expectRowCount(0);
  await expect(page.getByText(/Code: \d+|SYNTAX_ERROR/)).toHaveCount(0);
});

test('a hand-written link with a malformed condition tree drops the pill', async ({ page }) => {
  const logs = new LogsPage(page);
  const bad = [{ id: 'x', field: '', op: '=', value: '', cond: { join: 'xor', items: [] } }];
  await logs.open({ filters: JSON.stringify(bad) });
  await logs.expectRowCount(total);
  await expect(logs.filterBar.getByRole('button', { name: /^Filter actions:/ })).toHaveCount(0);
});

test('a hand-written link with a valid compound pill applies it', async ({ page }) => {
  const logs = new LogsPage(page);
  const pill = {
    id: 'x',
    field: '',
    op: '=',
    value: '',
    cond: {
      join: 'or',
      items: [
        { field: 'ServiceName', op: '=', value: 'auth' },
        { field: 'ServiceName', op: '=', value: 'checkout' },
      ],
    },
  };
  await logs.open({ filters: JSON.stringify([pill]) });
  await logs.expectRowCount(byService.auth + byService.checkout);
});
