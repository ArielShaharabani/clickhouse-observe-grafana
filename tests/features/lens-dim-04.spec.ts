import { expect } from '@grafana/plugin-e2e';
import type { Page } from '@playwright/test';
import { test } from '../fixtures';
import { VisualizePage } from '../pages/VisualizePage';
import { FIXTURE } from '../fixture';

// LENS-DIM-04 Top values editor options (docs/spec/20-lens.md). Fixture: five services,
// payments 9,264 and 8,064 each for the other four (41,520 in total).

const editor = (page: Page) => page.getByRole('dialog', { name: /^Edit / });

async function openTable(page: Page) {
  const viz = new VisualizePage(page);
  await viz.open();
  await viz.addField('ServiceName');
  await viz.dimensions.getByRole('button', { name: 'Edit Top 9 values of ServiceName' }).click();
  return viz;
}

/** The chart type switcher is hidden while the editor is open: close it, switch, reopen it. */
async function toTable(page: Page) {
  await editor(page).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Chart type: Bar' }).click();
  await page.getByRole('option', { name: /^Table/ }).click();
  await page.getByRole('button', { name: /^Edit (Top|Bottom|First|Last) \d+ values of ServiceName/ }).click();
}

/** Grafana's checkbox / radio inputs sit under their label, so click the label text. */
async function tick(page: Page, label: string) {
  const radio = editor(page).getByRole('radio', { name: label });
  if (await radio.count()) {
    await radio.check({ force: true });
    return;
  }
  await editor(page).getByText(label, { exact: true }).click();
}

async function setSize(page: Page, n: string) {
  const box = editor(page).getByRole('spinbutton', { name: 'Number of values' });
  await box.fill(n);
  await box.press('Enter');
}

test('Top 3 + Other: payments 9,264 and Other is the remaining 16,128', async ({ page }) => {
  const viz = await openTable(page);
  await setSize(page, '3');
  await tick(page, 'Group remaining values as Other');
  await toTable(page);
  const rest = FIXTURE.counts.total - FIXTURE.counts.payments - 2 * 8064;
  await expect(viz.chart.getByText('Other', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(String(rest), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
  // Nothing lost: the table rows sum to the total.
  await expect(viz.chart.getByText('payments', { exact: true })).toBeVisible();
});

test('without Other, only the top values are listed', async ({ page }) => {
  const viz = await openTable(page);
  await setSize(page, '3');
  await toTable(page);
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('Other', { exact: true })).toHaveCount(0);
});

test('rank alphabetically (ascending) top 1 is auth; descending is payments', async ({ page }) => {
  const viz = await openTable(page);
  await setSize(page, '1');
  await tick(page, 'Alphabetical');
  await toTable(page);
  await expect(viz.chart.getByText('auth', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('payments', { exact: true })).toHaveCount(0);
  await tick(page, 'Descending');
  await expect(viz.chart.getByText('payments', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
});

test('exclude values, and include by regular expression', async ({ page }) => {
  const viz = await openTable(page);
  await toTable(page);
  const exc = editor(page).getByLabel('Exclude values');
  await exc.fill('payments');
  await exc.blur();
  await expect(viz.chart.getByText('auth', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('payments', { exact: true })).toHaveCount(0);
  await exc.fill('');
  await exc.blur();
  await tick(page, 'Use regular expression');
  const inc = editor(page).getByLabel('Include values');
  await inc.fill('pay.*\nfront.*');
  await inc.blur();
  await expect(viz.chart.getByText('frontend', { exact: true })).toBeVisible();
  await expect(viz.chart.getByText(String(FIXTURE.counts.payments), { exact: true })).toBeVisible();
  await expect(viz.chart.getByText('auth', { exact: true })).toHaveCount(0);
});

test('a hostile include value is just a value (no rows, no error)', async ({ page }) => {
  const viz = await openTable(page);
  await toTable(page);
  const inc = editor(page).getByLabel('Include values');
  await inc.fill("x') OR 1=1 --");
  await inc.blur();
  await expect(viz.chart.getByText('auth', { exact: true })).toHaveCount(0);
  await expect(viz.chart.getByText('payments', { exact: true })).toHaveCount(0);
});

/** First cell of every body row of the table chart, in order. */
async function firstColumn(viz: VisualizePage) {
  const rows = viz.chart.getByRole('row');
  await expect(rows.nth(1)).toBeVisible();
  return rows.evaluateAll((els) =>
    els
      .slice(1)
      .map((r) => (r.querySelector('td,[role=cell],[role=gridcell]') as HTMLElement | null)?.innerText.trim() ?? '')
  );
}

test('alphabetical rank lists values in alphabetical order, Other always last', async ({ page }) => {
  const viz = await openTable(page);
  await tick(page, 'Alphabetical');
  await setSize(page, '5');
  await toTable(page);
  await expect.poll(() => firstColumn(viz)).toEqual(['auth', 'checkout', 'frontend', 'inventory', 'payments']);
  await tick(page, 'Descending');
  await expect.poll(() => firstColumn(viz)).toEqual(['payments', 'inventory', 'frontend', 'checkout', 'auth']);
  await setSize(page, '2');
  await tick(page, 'Group remaining values as Other');
  await expect.poll(() => firstColumn(viz)).toEqual(['payments', 'inventory', 'Other']);
});

test('invalid regular expression shows a message under the field', async ({ page }) => {
  await openTable(page);
  await tick(page, 'Use regular expression');
  await editor(page).getByLabel('Include values').fill('a)|(.*');
  await expect(editor(page).getByRole('alert')).toContainText('Unbalanced parentheses');
});
